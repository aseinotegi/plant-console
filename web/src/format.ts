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

/** A number the Spanish way (6,71), with a fixed number of decimals. */
export function dec(v: unknown, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}

export const num = dec;

export function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : dec(v, 2);
  if (typeof v === "boolean") return v ? "sí" : "no";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export const ROBOT_STATE: Record<string, string> = {
  "en-ruta": "En ruta",
  inspeccionando: "Haciendo foto",
  comprobando: "Comprobando válvula",
  "en-mision": "En misión",
  actuando: "Cerrando válvula",
  cargando: "Cargando",
};

export type Tone = "ok" | "warn" | "bad" | "idle";

export function qualityTone(q: unknown): Tone {
  if (q === "good") return "ok";
  if (q === "uncertain" || q === "stale") return "warn";
  if (q === "rejected" || q === "error") return "bad";
  return "idle";
}

const QUALITY: Record<string, string> = { good: "fiable", uncertain: "dudosa", rejected: "rechazada", stale: "caducada", error: "error" };
export const qualityLabel = (q: unknown) => (typeof q === "string" ? (QUALITY[q] ?? q) : "—");

const REASON: Record<string, string> = {
  lectura_valida: "lectura válida",
  no_legible: "no legible",
  no_encontrado: "no encontrado",
  correcto: "correcto",
  fuera_de_soporte: "fuera de soporte",
  ausente: "ausente",
  presion_baja: "presión baja",
};
export const reasonLabel = (r: unknown) => (typeof r === "string" ? (REASON[r] ?? r.replace(/_/g, " ")) : "—");

/** "PT-104 presión" from planta1/exterior/pt-104/presion */
export function topicLabel(topic: string): string {
  const parts = topic.split("/");
  const device = parts[2]?.toUpperCase() ?? topic;
  const what = parts.slice(3).join(" ").replace(/-/g, " ");
  return `${device} ${what}`.trim();
}

/** One line of the event log, in plant words. */
export function describe(entry: Entry): { text: string; tone: Tone } | null {
  const p: Payload = payloadOf(entry);
  const v = p.value;
  const topic = entry.topic;
  if (topic === T.photo) return { text: `robot-01 fotografía ${show(p.poi)}`, tone: "idle" };
  if (topic.includes("/ultima-foto/")) return null; // the same photo, kept for latecomers
  if (topic.endsWith("/inspeccion")) {
    const value = v === null || v === undefined ? "sin lectura" : `${show(v)}${p.unit ? ` ${p.unit}` : ""}`;
    const conf = typeof p.confidence === "number" ? `, ${Math.round(p.confidence * 100)} %` : "";
    return {
      text: `Visión ${show(p.poi)}: ${value}, ${reasonLabel(p.status_reason)} (${qualityLabel(p.quality)}${conf})`,
      tone: qualityTone(p.quality),
    };
  }
  if (typeof entry.payload === "object" && entry.payload.source === "inspector") return null; // the inspection says it
  if (topic.startsWith(T.rules)) {
    const rule = topic.slice(T.rules.length);
    return v === "activa" ? { text: `Regla ${rule} activa`, tone: "bad" } : { text: `Regla ${rule} vuelve a normal`, tone: "ok" };
  }
  if (topic === T.xv104Order) return { text: `Orden a XV-104: ${show(v)} (regla ${show(p.rule)})`, tone: "warn" };
  if (topic === T.mission) return { text: `Misión a XV-104 ${v === "completada" ? "completada" : "en camino"}`, tone: "warn" };
  if (topic === T.xv104) return { text: `XV-104 ${show(v)}, comprobada por robot-01`, tone: v === "cerrada" ? "warn" : "idle" };
  if (topic === T.pt104Alarm) return { text: `PLC: alarma de alta presión ${v ? "activada" : "desactivada"}`, tone: v ? "bad" : "ok" };
  if (topic === T.lt101Alarm) return { text: `PLC: nivel alto en T-101 ${v ? "activado" : "desactivado"}`, tone: v ? "bad" : "ok" };
  if (topic === T.p104Run) return { text: `P-104 ${v ? "arranca" : "para"} (control de nivel del PLC)`, tone: "idle" };
  if (topic === T.p104Starts) return null;
  if (topic.startsWith(T.simulation)) {
    return topic.endsWith("/resultado") && v === "en-marcha" ? { text: "Simulación: perturbación lanzada desde la consola", tone: "warn" } : null;
  }
  if (topic === T.rulesConfig) return { text: `Motor de reglas: ${show(v)}, ${show(p.detail)}`, tone: v === "error" ? "bad" : "idle" };
  if (topic.startsWith(T.services) && (typeof entry.payload !== "object" || !("value" in entry.payload))) return null;
  if (topic.startsWith(T.services)) return { text: `Servicio ${topic.slice(T.services.length)}: ${show(v)}`, tone: v === "offline" ? "bad" : "idle" };
  return { text: `${topicLabel(topic)} = ${show(v)}`, tone: "idle" };
}
