// The live picture of the plant in the browser: one WebSocket to /api/ws, the last
// message of every topic, the event log and short trends. Components read it with
// useLive(); updates are batched to one render per animation frame.

import { useSyncExternalStore } from "react";

export type Payload = { value?: unknown; [key: string]: unknown };

export interface PhotoCredit {
  autor: string;
  licencia: string;
  fuente: string;
  poi: string;
  valor: string;
  condicion: string;
}

export interface Entry {
  topic: string;
  payload: Payload | string;
  retained: boolean;
  t: number; // seconds, console clock
}

const MAX_EVENTS = 400;
const MAX_RAW = 600; // the MQTT terminal
const TREND_S = 900;

function numeric(entry: Entry): number | null {
  const p = entry.payload;
  if (typeof p !== "object" || p === null) return null;
  const v = p.value;
  return typeof v === "number" ? v : null;
}

export function payloadOf(entry: Entry | undefined): Payload {
  if (!entry || typeof entry.payload !== "object" || entry.payload === null) return {};
  return entry.payload;
}

/** When the value was produced: the publisher's ts if it has one, else when the console got it. */
export function stamp(entry: Entry | undefined): number | undefined {
  if (!entry) return undefined;
  const ts = payloadOf(entry).ts;
  const parsed = typeof ts === "string" ? Date.parse(ts) / 1000 : NaN;
  return Number.isFinite(parsed) ? parsed : entry.t;
}

/** A short text for any payload: the value, or a few fields of a diagnostic object. */
export function summary(entry: Entry | undefined): string {
  if (!entry) return "—";
  if (typeof entry.payload === "string") return entry.payload;
  const p = entry.payload;
  if ("value" in p) return p.value === null ? "—" : typeof p.value === "object" ? JSON.stringify(p.value) : String(p.value);
  return Object.entries(p)
    .filter(([k, v]) => k !== "ts" && (typeof v !== "object" || v === null))
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export function photoUrl(url: unknown): string | null {
  // The world's URL is only reachable inside the plant network: go through the API.
  if (typeof url !== "string") return null;
  const name = url.split("/").pop();
  return name ? `/api/fotos/${name}` : null;
}

class LiveStore {
  topics = new Map<string, Entry>();
  events: Entry[] = [];
  trends = new Map<string, [number, number][]>();
  photos = new Map<string, string>(); // image id → photo URL, from the robot's photo messages
  raw: Entry[] = []; // every message as it arrives, for the MQTT terminal
  inspections: Entry[] = []; // every inspection since the console started, for the analytics
  trail: [number, number][] = []; // the robot's last positions
  socket = false;
  broker = false;
  grafanaUrl = "";
  showroom = false; // the public demo: read-only rules, no probes
  uploads = true;
  trialsPerHour = 0; // per visitor, 0: no limit
  credits: Record<string, PhotoCredit> = {};
  rate = 0; // messages per second
  version = 0;

  private listeners = new Set<() => void>();
  private pending = false;
  private count = 0;
  private backfilled = new Set<string>();

  start() {
    this.open();
    setInterval(() => {
      this.rate = this.count;
      this.count = 0;
      this.changed();
    }, 1000);
    setInterval(() => this.checkBroker(), 5000);
    this.checkBroker();
    this.loadCredits();
  }

  private async loadCredits() {
    try {
      const r = await fetch("/api/fotos");
      if (r.ok) this.credits = await r.json();
      else setTimeout(() => this.loadCredits(), 5000);
    } catch {
      setTimeout(() => this.loadCredits(), 5000);
    }
  }

  private async checkBroker() {
    try {
      const r = await fetch("/api/estado");
      const body = r.ok ? await r.json() : {};
      this.broker = body.broker === true;
      this.grafanaUrl = body.grafana_url || `${location.protocol}//${location.hostname}:3000`;
      this.showroom = body.showroom === true;
      this.uploads = body.uploads !== false;
      this.trialsPerHour = Number(body.trials_per_visitor_hour) || 0;
    } catch {
      this.broker = false;
    }
    this.changed();
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    ws.onopen = () => {
      this.socket = true;
      this.changed();
    };
    ws.onclose = () => {
      this.socket = false;
      this.changed();
      setTimeout(() => this.open(), 2000);
    };
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "snapshot") {
        this.topics = new Map(Object.entries(data.topics as Record<string, Entry>));
        this.events = data.events as Entry[];
        this.broker = data.connected === true;
        for (const e of this.events) this.notePhoto(e);
        this.inspections = this.events.filter((e) => e.topic.endsWith("/inspeccion"));
        for (const e of this.topics.values()) {
          this.notePhoto(e);
          this.addPoint(e);
        }
      } else {
        const entry: Entry = { topic: data.topic, payload: data.payload, retained: data.retained, t: data.t };
        this.topics.set(entry.topic, entry);
        this.raw.push(entry);
        if (this.raw.length > MAX_RAW) this.raw.splice(0, this.raw.length - MAX_RAW);
        if (entry.topic.endsWith("/posicion")) this.addTrail(entry);
        this.addPoint(entry);
        this.notePhoto(entry);
        if (data.event && entry.topic.endsWith("/inspeccion")) {
          this.inspections.push(entry);
          if (this.inspections.length > 2000) this.inspections.shift();
        }
        if (data.event) {
          this.events.push(entry);
          if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        }
        this.count++;
      }
      this.changed();
    };
  }

  private addTrail(entry: Entry) {
    const p = payloadOf(entry);
    if (typeof p.x !== "number" || typeof p.y !== "number") return;
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(last[0] - p.x, last[1] - p.y) < 0.6) return;
    this.trail.push([p.x, p.y]);
    if (this.trail.length > 60) this.trail.shift();
  }

  private notePhoto(entry: Entry) {
    const p = payloadOf(entry);
    // the photo messages, and the last photo of each point (retained, survives a reload)
    if ((entry.topic.endsWith("/foto") || entry.topic.includes("/ultima-foto/")) && typeof p.value === "string") {
      const url = photoUrl(p.image_url);
      if (url) this.photos.set(p.value, url);
    }
  }

  private addPoint(entry: Entry) {
    if (entry.retained) return; // old state, not a point in time
    const v = numeric(entry);
    if (v === null) return;
    const series = this.trends.get(entry.topic) ?? [];
    if (series.length && series[series.length - 1][0] >= entry.t) return;
    series.push([entry.t, v]);
    while (series.length && series[0][0] < entry.t - TREND_S) series.shift();
    this.trends.set(entry.topic, series);
  }

  /** Brings the server's recent history for a topic, once, in front of what is already here. */
  async backfill(topic: string) {
    if (this.backfilled.has(topic)) return;
    this.backfilled.add(topic);
    const r = await fetch(`/api/historia?topic=${encodeURIComponent(topic)}&s=${TREND_S}`);
    if (!r.ok) return;
    const points = (await r.json()).points as [number, number][];
    const series = this.trends.get(topic) ?? [];
    const first = series.length ? series[0][0] : Infinity;
    this.trends.set(topic, [...points.filter((p) => p[0] < first), ...series]);
    this.changed();
  }

  get(topic: string): Entry | undefined {
    return this.topics.get(topic);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.version++;
      for (const l of this.listeners) l();
    });
  }
}

export const live = new LiveStore();

/** Re-renders the component whenever the plant changes (at most once per frame). */
export function useLive(): LiveStore {
  useSyncExternalStore(live.subscribe, () => live.version);
  return live;
}

/** A clock for "hace 3 s" labels. */
export function useNow(): number {
  useLive(); // the rate timer ticks every second
  return Date.now() / 1000;
}
