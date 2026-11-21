// The containers of the demo as the console sees them from its own networks, and how
// they are wired: networks as zones, the broker in the middle.

import { useEffect, useState } from "react";
import { Badge } from "../components/bits";
import { dec } from "../format";
import { useLive } from "../live";

export interface Service {
  nombre: string;
  imagen: string;
  redes: string[];
  puertos: string[];
  ips: string[];
  visible: boolean;
  tcp_ms: number | null;
  tcp: string | null;
  senal: { topic: string; valor: unknown; edad_s: number; ok: boolean } | null;
  estado: "ok" | "degradado" | "caido" | "sin-datos";
}

const STATE: Record<Service["estado"], { label: string; tone: "ok" | "warn" | "bad" | "idle" }> = {
  ok: { label: "Healthy", tone: "ok" },
  degradado: { label: "Degradado", tone: "warn" },
  caido: { label: "Caído", tone: "bad" },
  "sin-datos": { label: "Sin datos", tone: "idle" },
};

interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
  w?: number;
  kind?: "hub" | "fw" | "edge" | "demo"; // edge and fw: no container behind, no state
  showroom?: boolean; // only drawn in the public demo
}

// From the plant floor up: the PLC behind the OT/IT firewall, the UNS in the middle,
// the database apart, and what a browser reaches on top.
const BOXES: Box[] = [
  { id: "cloudflared", label: "Cloudflare Tunnel", x: 565, y: 68, kind: "edge", showroom: true },
  { id: "console", label: "consola · HMI", x: 330, y: 68 },
  { id: "grafana", label: "grafana", x: 800, y: 68 },
  { id: "inspector", label: "inspector · visión", x: 130, y: 172, w: 180 },
  { id: "plc-gateway", label: "plc-mqtt-gateway", x: 130, y: 252, w: 180 },
  { id: "rules", label: "reglas", x: 335, y: 252 },
  { id: "broker", label: "Mosquitto", x: 520, y: 182, kind: "hub" },
  { id: "historian", label: "historian", x: 705, y: 252 },
  { id: "timescaledb", label: "timescaledb", x: 885, y: 182 },
  { id: "firewall", label: "SCALANCE SC-600", x: 500, y: 309, w: 190, kind: "fw" },
  { id: "world", label: "PLC-1", x: 230, y: 420 },
  { id: "robot", label: "robot", x: 500, y: 420 },
  { id: "simulador", label: "escenario", x: 770, y: 420, kind: "demo" },
];

const LINKS: [string, string, string, "mqtt" | "other"][] = [
  ["cloudflared", "console", "https", "other"],
  ["cloudflared", "grafana", "https", "other"],
  ["console", "broker", "", "mqtt"],
  ["grafana", "timescaledb", "sql", "other"],
  ["inspector", "broker", "", "mqtt"],
  ["rules", "broker", "", "mqtt"],
  ["historian", "broker", "", "mqtt"],
  ["historian", "timescaledb", "sql", "other"],
  ["plc-gateway", "broker", "", "mqtt"],
  ["plc-gateway", "firewall", "s7", "other"],
  ["firewall", "broker", "", "mqtt"],
  ["world", "firewall", "s7", "other"],
  ["robot", "firewall", "", "mqtt"],
  ["simulador", "firewall", "", "mqtt"],
  ["robot", "world", "", "other"],
  ["simulador", "world", "", "other"],
];

// Which way the data goes. Reading: from the field up to whoever looks at it.
// Writing: the only two ways down, and neither touches the PLC.
export type Mode = "todo" | "lectura" | "escritura";
const FLOWS: Record<Exclude<Mode, "todo">, [string, string][]> = {
  lectura: [
    ["world", "firewall"], ["firewall", "plc-gateway"], ["plc-gateway", "broker"],
    ["robot", "firewall"], ["firewall", "broker"], ["broker", "inspector"],
    ["broker", "rules"], ["broker", "historian"], ["historian", "timescaledb"], ["timescaledb", "grafana"],
    ["broker", "console"], ["console", "cloudflared"], ["grafana", "cloudflared"],
  ],
  escritura: [
    ["cloudflared", "console"], ["console", "broker"], ["broker", "firewall"], ["firewall", "simulador"], ["simulador", "world"],
    ["rules", "broker"], ["firewall", "robot"], ["robot", "world"],
  ],
};

export function useServices(): Service[] {
  const [s, setS] = useState<Service[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/servicios");
        if (r.ok && alive) setS((await r.json()).servicios);
      } catch {
        /* next tick */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return s;
}

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="segmented arch-modes" role="group" aria-label="Flujo de datos">
      {(["todo", "lectura", "escritura"] as Mode[]).map((m) => (
        <button key={m} className={`btn small ${mode === m ? "primary" : ""}`} onClick={() => onChange(m)}>
          {m === "todo" ? "Todo" : m === "lectura" ? "Lectura" : "Escritura"}
        </button>
      ))}
    </div>
  );
}

/** The networks and services, from the plant floor up, with the read or write flow lit. */
export function ArchDiagram({ services, mode }: { services: Service[]; mode: Mode }) {
  const { showroom } = useLive();
  const by = (id: string) => services.find((s) => s.nombre === id);
  const boxes = BOXES.filter((b) => showroom || !b.showroom);
  const at = (id: string) => boxes.find((b) => b.id === id);
  const flow = mode === "todo" ? [] : FLOWS[mode].filter(([a, b]) => at(a) && at(b));
  const inFlow = new Set(flow.flat());
  return (
    <svg viewBox="0 0 1000 510" className={`arch ${mode}`} role="img" aria-label="Redes y servicios">
      <Zone y={22} h={92} label="publica" />
      <Zone y={124} h={170} w={760} label="uns" />
      <Zone x={780} y={124} h={170} w={210} label="datos" />
      <Zone y={304} h={196} label="campo" />
      {LINKS.map(([a, b, label, kind]) => {
        const A = at(a);
        const B = at(b);
        if (!A || !B) return null;
        return (
          <g key={a + b} className={`link ${kind}`}>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} />
            {label && (
              <text x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 5}>
                {label}
              </text>
            )}
          </g>
        );
      })}
      {flow.map(([a, b]) => {
        const A = at(a)!;
        const B = at(b)!;
        return <line key={`${a}>${b}`} className={`flow ${mode}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />;
      })}
      {boxes.map((b) => {
        const w = b.w ?? 160;
        const s = by(b.id);
        const state = s?.estado ?? "sin-datos";
        const plain = b.kind === "fw" || b.kind === "edge";
        const x = plain ? 14 : 28;
        return (
          <g key={b.id} className={`svc ${b.kind ?? ""} ${plain ? "" : `st-${state}`} ${mode !== "todo" && !inFlow.has(b.id) ? "dim" : ""}`} transform={`translate(${b.x - w / 2},${b.y - 22})`}>
            {b.kind === "fw" && <title>Referencia de planta; en la demo lo hacen las redes Docker</title>}
            <rect width={w} height={44} rx={8} />
            {!plain && <circle cx={16} cy={22} r={5} className={`state ${state}`} />}
            <text x={x} y={20} className="svc-name">
              {b.label}
            </text>
            <text x={x} y={35} className="svc-role">
              {b.kind === "fw" ? "firewall OT / IT" : b.kind === "edge" ? "internet" : s?.visible ? s.ips[0] : s ? "aislada" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ArchitecturePage() {
  const services = useServices();
  const healthy = services.filter((s) => s.estado === "ok").length;
  const [mode, setMode] = useState<Mode>("todo");

  return (
    <div className="arch-page">
      <header className="panel-head row-between">
        <h1>Arquitectura</h1>
        <ModeToggle mode={mode} onChange={setMode} />
        <Badge tone={healthy === services.length && services.length ? "ok" : "warn"}>
          {healthy}/{services.length} healthy
        </Badge>
      </header>

      <section className="card arch-card">
        <ArchDiagram services={services} mode={mode} />
      </section>

      <section className="card">
        <table className="services">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Contenedor</th>
              <th>Imagen</th>
              <th>Redes</th>
              <th>IP</th>
              <th>Puertos</th>
              <th className="num">TCP</th>
              <th>Señal en el UNS</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.nombre}>
                <td>
                  <Badge tone={STATE[s.estado].tone}>{STATE[s.estado].label}</Badge>
                </td>
                <td className="strong">{s.nombre}</td>
                <td className="mono-cell">{s.imagen}</td>
                <td>
                  {s.redes.map((r) => (
                    <span key={r} className={`net ${r}`}>
                      {r}
                    </span>
                  ))}
                </td>
                <td className="mono-cell">{s.visible ? s.ips.join(", ") : <span className="muted">aislada</span>}</td>
                <td className="mono-cell">{s.puertos.join(" · ") || "—"}</td>
                <td className="num">{s.tcp ? (s.tcp_ms !== null ? `${dec(s.tcp_ms, 1)} ms` : "sin respuesta") : "—"}</td>
                <td className="mono-cell">
                  {s.senal ? (
                    <>
                      {String(s.senal.valor)} <span className="muted">· {Math.round(s.senal.edad_s)} s</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

    </div>
  );
}

export function Zone({ x = 10, y, w = 980, h, label }: { x?: number; y: number; w?: number; h: number; label: string }) {
  return (
    <g className={`zone ${label}`}>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text x={x + 12} y={y + h - 10} className="zone-label">
        {label}
      </text>
    </g>
  );
}
