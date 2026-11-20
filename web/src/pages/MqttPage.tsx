// What arrives at the broker, as it arrives: the same view as mosquitto_sub -v, with
// the broker's own statistics ($SYS) on top.

import { useEffect, useRef, useState } from "react";
import { Card } from "../components/bits";
import { type Entry, payloadOf, useLive } from "../live";

const FAST = /\/(posicion|escenario)$|pt-104\/presion$|ft-104|tt-104|lt-101\/nivel$|p-104\/corriente$/;

function matches(pattern: string, topic: string): boolean {
  if (!pattern.includes("+") && !pattern.includes("#")) return topic.includes(pattern);
  const p = pattern.split("/");
  const t = topic.split("/");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "#") return true;
    if (i >= t.length || (p[i] !== "+" && p[i] !== t[i])) return false;
  }
  return p.length === t.length;
}

function sys(live: ReturnType<typeof useLive>, path: string): string {
  const e = live.get(`$SYS/broker/${path}`);
  if (!e) return "—";
  const text = String(typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload));
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("es-ES") : text;
}

export function MqttPage() {
  const live = useLive();
  const [filter, setFilter] = useState("planta1/#");
  const [hideFast, setHideFast] = useState(true);
  const [paused, setPaused] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<Entry | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const source = paused ?? live.raw;
  const lines = source.filter((e) => matches(filter.trim() || "#", e.topic) && !(hideFast && FAST.test(e.topic))).slice(-250);

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length, paused]);

  const uptime = Number(String(payloadOf(live.get("$SYS/broker/uptime")).value ?? live.get("$SYS/broker/uptime")?.payload ?? "").split(" ")[0]);
  return (
    <div className="mqtt-page">
      <header className="panel-head">
        <h1>MQTT en vivo</h1>
        <p className="muted">
          Todo lo que pasa por el broker, tal cual llega. La consola entra con un usuario que solo puede leer; para ver lo mismo desde tu PC, MQTT Explorer o mosquitto_sub contra localhost:1883 con el usuario de solo lectura <code>explorer</code>.
        </p>
      </header>
      <div className="broker-stats">
        <Stat label="Clientes conectados" value={sys(live, "clients/connected")} />
        <Stat label="Mensajes por minuto, entrada" value={sys(live, "load/messages/received/1min")} />
        <Stat label="Mensajes por minuto, salida" value={sys(live, "load/messages/sent/1min")} />
        <Stat label="Temas retenidos" value={sys(live, "retained messages/count")} />
        <Stat label="En marcha" value={Number.isFinite(uptime) ? `${Math.floor(uptime / 60)} min` : "—"} />
        <Stat label="Broker" value={sys(live, "version").replace("mosquitto version ", "Mosquitto ")} />
      </div>
      <Card className="terminal-card">
        <div className="terminal-bar">
          <label>
            Filtro{" "}
            <input value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} aria-label="Filtro de temas MQTT, admite + y #" />
          </label>
          <label className="check">
            <input type="checkbox" checked={hideFast} onChange={(e) => setHideFast(e.target.checked)} /> Ocultar señales rápidas (posición del robot, PLC)
          </label>
          <button className="btn small" onClick={() => setPaused(paused ? null : [...live.raw])}>
            {paused ? "Seguir" : "Pausar"}
          </button>
        </div>
        <div className="terminal" ref={box} role="log" aria-live="off">
          {lines.map((e, i) => (
            <button key={`${e.t}-${i}`} className={`line ${area(e.topic)}`} onClick={() => setOpen(open === e ? null : e)}>
              <span className="t">{new Date(e.t * 1000).toLocaleTimeString("es-ES", { hour12: false })}</span>
              <span className="topic">{e.topic}</span>
              {e.retained && <span className="r">R</span>}
              <span className="payload">{typeof e.payload === "string" ? e.payload : compact(e)}</span>
              {open === e && <pre className="full">{JSON.stringify(e.payload, null, 2)}</pre>}
            </button>
          ))}
          {lines.length === 0 && <p className="muted">Esperando mensajes que pasen el filtro…</p>}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function area(topic: string): string {
  if (topic.startsWith("$SYS")) return "sys";
  if (topic.includes("/reglas/") || topic.endsWith("/orden")) return "rule";
  if (topic.includes("/robots/")) return "robot";
  if (topic.includes("/servicios/") || topic.includes("/simulacion/")) return "svc";
  if (topic.includes("/inspeccion")) return "vision";
  return "data";
}

function compact(e: Entry): string {
  const text = JSON.stringify(e.payload);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
