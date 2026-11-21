// The containers of the demo as the console sees them from its own networks, and how
// they are wired: networks as zones, the broker in the middle.

import { useEffect, useState } from "react";
import { Badge } from "../components/bits";
import { dec } from "../format";

interface Service {
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
  x: number;
  y: number;
  w?: number;
}

const BOXES: Box[] = [
  { id: "console", x: 330, y: 70 },
  { id: "grafana", x: 800, y: 70 },
  { id: "inspector", x: 120, y: 190 },
  { id: "rules", x: 330, y: 255 },
  { id: "broker", x: 520, y: 190, w: 180 },
  { id: "historian", x: 690, y: 255 },
  { id: "timescaledb", x: 880, y: 190 },
  { id: "plc-gateway", x: 260, y: 360 },
  { id: "robot", x: 500, y: 360 },
  { id: "simulador", x: 740, y: 360 },
  { id: "world", x: 500, y: 455, w: 200 },
];

const LINKS: [string, string, string, "mqtt" | "other"][] = [
  ["console", "broker", "", "mqtt"],
  ["console", "robot", "http", "other"],
  ["grafana", "timescaledb", "sql", "other"],
  ["inspector", "broker", "", "mqtt"],
  ["inspector", "robot", "http", "other"],
  ["rules", "broker", "", "mqtt"],
  ["historian", "broker", "", "mqtt"],
  ["historian", "timescaledb", "sql", "other"],
  ["plc-gateway", "broker", "", "mqtt"],
  ["robot", "broker", "", "mqtt"],
  ["simulador", "broker", "", "mqtt"],
  ["plc-gateway", "world", "s7", "other"],
  ["robot", "world", "http", "other"],
  ["simulador", "world", "http", "other"],
];

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

export function ArchitecturePage() {
  const services = useServices();
  const by = (id: string) => services.find((s) => s.nombre === id);
  const at = (id: string) => BOXES.find((b) => b.id === id)!;
  const healthy = services.filter((s) => s.estado === "ok").length;

  return (
    <div className="arch-page">
      <header className="panel-head row-between">
        <h1>Arquitectura</h1>
        <Badge tone={healthy === services.length && services.length ? "ok" : "warn"}>
          {healthy}/{services.length} healthy
        </Badge>
      </header>

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

      <section className="card arch-card">
        <svg viewBox="0 0 1000 510" className="arch" role="img" aria-label="Redes y servicios">
          <Zone y={22} h={92} label="publica" />
          <Zone y={124} h={170} w={760} label="uns" />
          <Zone x={780} y={124} h={170} w={210} label="datos" />
          <Zone y={304} h={196} label="campo" />
          {LINKS.map(([a, b, label, kind]) => {
            const A = at(a);
            const B = at(b);
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
          {BOXES.map((b) => {
            const w = b.w ?? 160;
            const s = by(b.id);
            const state = s?.estado ?? "sin-datos";
            return (
              <g key={b.id} className={`svc ${b.id === "broker" ? "hub" : ""}`} transform={`translate(${b.x - w / 2},${b.y - 22})`}>
                <rect width={w} height={44} rx={8} />
                <circle cx={16} cy={22} r={5} className={`state ${state}`} />
                <text x={28} y={20} className="svc-name">
                  {b.id}
                </text>
                <text x={28} y={35} className="svc-role">
                  {s?.visible ? s.ips[0] : s ? "aislada" : ""}
                </text>
              </g>
            );
          })}
        </svg>
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
