import type { Entry, Payload } from "./live";
import { payloadOf } from "./live";
import { T } from "./topics";

export function ago(t: number | undefined, now: number): string {
  if (t === undefined) return "—";
  const s = Math.max(0, Math.round(now - t));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

export function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString("es-ES", { hour12: false });
}

export function num(v: unknown, digits = 2): string {
  return typeof v === "number" ? v.toFixed(digits) : "—";
}

export function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "true" : "false";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export const ROBOT_STATE: Record<string, string> = {
  "en-ruta": "En ruta",
  inspeccionando: "Haciendo foto",
  comprobando: "Comprobando válvula",
  "en-mision": "En misión",
  actuando: "Cerrando válvula",
};

export type Tone = "ok" | "warn" | "bad" | "idle";

export function qualityTone(q: unknown): Tone {
  if (q === "good") return "ok";
  if (q === "uncertain") return "warn";
  if (q === "rejected") return "bad";
  return "idle";
}

const QUALITY: Record<string, string> = { good: "buena", uncertain: "dudosa", rejected: "rechazada" };
export const qualityLabel = (q: unknown) => (typeof q === "string" ? (QUALITY[q] ?? q) : "—");

/** One line of the event log, in plant words. */
export function describe(entry: Entry): { text: string; tone: Tone } | null {
  const p: Payload = payloadOf(entry);
  const v = p.value;
  const topic = entry.topic;
  if (topic === T.photo) return { text: `robot-01 fotografía ${show(p.poi)} (${show(v)})`, tone: "idle" };
  if (topic.endsWith("/inspeccion")) {
    const poi = show(p.poi);
    const value = v === null || v === undefined ? "sin lectura" : `${show(v)}${p.unit ? ` ${p.unit}` : ""}`;
    const conf = typeof p.confidence === "number" ? `, ${Math.round(p.confidence * 100)} %` : "";
    return {
      text: `Visión ${poi}: ${value} · ${show(p.status_reason)} (${qualityLabel(p.quality)}${conf})`,
      tone: qualityTone(p.quality),
    };
  }
  if (topic === T.pi104 || topic === T.ext12) return null; // the inspection line already says it
  if (topic.startsWith(T.rules)) {
    const rule = topic.slice(T.rules.length);
    return v === "activa"
      ? { text: `Regla ${rule}: ACTIVA`, tone: "bad" }
      : { text: `Regla ${rule}: vuelve a normal`, tone: "ok" };
  }
  if (topic === T.xv104Order) return { text: `Orden a XV-104: ${show(v)} (regla ${show(p.rule)})`, tone: "warn" };
  if (topic === T.mission)
    return { text: `Misión a XV-104: ${v === "completada" ? "completada" : "en camino"}`, tone: "warn" };
  if (topic === T.xv104)
    return { text: `XV-104 ${show(v)} (lo comprueba robot-01)`, tone: v === "cerrada" ? "warn" : "idle" };
  if (topic === T.pt104Alarm)
    return { text: `PLC: alarma de alta presión ${v ? "ON" : "OFF"}`, tone: v ? "bad" : "ok" };
  if (topic === T.rulesConfig) return { text: `Motor de reglas: ${show(v)} ${show(p.detail)}`, tone: v === "error" ? "bad" : "idle" };
  if (topic.startsWith(T.services) && (typeof entry.payload !== "object" || !("value" in entry.payload)))
    return null; // diagnostics of other tools (counters, connection details), not events
  if (topic.startsWith(T.services)) return { text: `${topic.slice(T.services.length)}: ${show(v)}`, tone: "idle" };
  return { text: `${topic} = ${show(v)}`, tone: "idle" };
}
