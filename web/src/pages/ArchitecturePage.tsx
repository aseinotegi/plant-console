// How the demo is wired: networks as zones (bottom: the plant floor, top: the browser),
// every service with its live status from the UNS, and what talks to what.

import { Card } from "../components/bits";
import { payloadOf, useLive } from "../live";
import { T } from "../topics";

type Status = "online" | "offline" | "unknown";

interface Box {
  id: string;
  name: string;
  role: string;
  x: number;
  y: number;
  w?: number;
}

const BOXES: Box[] = [
  { id: "browser", name: "Navegador", role: "tú", x: 500, y: 52, w: 170 },
  { id: "console", name: "console", role: "esta consola, :8000", x: 330, y: 150 },
  { id: "grafana", name: "grafana", role: "histórico, :3000", x: 800, y: 150 },
  { id: "inspector", name: "inspector", role: "visión (modelo multimodal)", x: 120, y: 262 },
  { id: "rules", name: "rules", role: "motor de reglas", x: 330, y: 330 },
  { id: "broker", name: "broker", role: "Mosquitto, UNS, :1883", x: 520, y: 262, w: 190 },
  { id: "historian", name: "historian", role: "UNS a base de datos", x: 690, y: 330 },
  { id: "timescaledb", name: "timescaledb", role: "base de datos", x: 880, y: 262 },
  { id: "plc-gateway", name: "plc-gateway", role: "S7 a MQTT, solo lectura", x: 260, y: 430 },
  { id: "robot-01", name: "robot", role: "fotos y mapa, :8081", x: 500, y: 430 },
  { id: "simulador", name: "simulador", role: "controles de la demo", x: 740, y: 430 },
  { id: "world", name: "world", role: "planta física y PLC S7, :1102", x: 500, y: 525, w: 260 },
];

// [from, to, label, kind]: MQTT links are drawn in the accent colour and need no label.
const LINKS: [string, string, string, "mqtt" | "other"][] = [
  ["browser", "console", "HTTP y WebSocket", "other"],
  ["browser", "grafana", "HTTP", "other"],
  ["console", "broker", "", "mqtt"],
  ["grafana", "timescaledb", "SQL, solo lectura", "other"],
  ["inspector", "broker", "", "mqtt"],
  ["rules", "broker", "", "mqtt"],
  ["historian", "broker", "", "mqtt"],
  ["historian", "timescaledb", "SQL", "other"],
  ["plc-gateway", "broker", "", "mqtt"],
  ["robot-01", "broker", "", "mqtt"],
  ["simulador", "broker", "", "mqtt"],
  ["plc-gateway", "world", "S7", "other"],
  ["robot-01", "world", "cámara y brazo", "other"],
  ["simulador", "world", "HTTP", "other"],
];

export function ArchitecturePage() {
  const live = useLive();
  const status = (id: string): Status => {
    if (id === "console" || id === "browser") return live.socket ? "online" : "offline";
    if (id === "broker") return live.broker ? "online" : "offline";
    const e = live.get(`${T.services}${id}`) ?? live.get(`${T.services}${id}/status`);
    if (!e) return "unknown";
    const v = typeof e.payload === "string" ? e.payload : (payloadOf(e).value ?? (e.payload as Record<string, unknown>).gateway);
    return v === "online" ? "online" : v === "offline" ? "offline" : "unknown";
  };
  const at = (id: string) => BOXES.find((b) => b.id === id)!;

  return (
    <div className="arch-page">
      <header className="panel-head">
        <h1>Arquitectura</h1>
        <p className="muted">
          Cada caja es un contenedor de Docker y cada franja una red. Abajo la planta, arriba tu navegador: como en el modelo Purdue, cada nivel solo habla con el de al lado. El punto de cada servicio es su estado real en el UNS.
        </p>
      </header>
      <Card className="arch-card">
        <svg viewBox="0 0 1000 580" className="arch" role="img" aria-label="Esquema de redes y servicios">
          <Zone y={100} h={92} label="publica" note="lo único que se publica: 8000 y 3000" />
          <Zone y={200} h={175} w={760} label="uns" note="broker y servicios" />
          <Zone x={780} y={200} h={175} w={210} label="datos" note="sin salida a internet" closed />
          <Zone y={385} h={185} label="campo" note="la planta: sin salida, nadie de fuera llega al PLC" closed />

          {LINKS.map(([a, b, label, kind]) => {
            const A = at(a);
            const B = at(b);
            const mx = (A.x + B.x) / 2;
            const my = (A.y + B.y) / 2;
            return (
              <g key={a + b} className={`link ${kind}`}>
                <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} />
                {label && (
                  <text x={mx} y={my - 5}>
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {BOXES.map((b) => {
            const w = b.w ?? 170;
            const s = status(b.id);
            return (
              <g key={b.id} className={`svc ${b.id === "broker" ? "hub" : ""}`} transform={`translate(${b.x - w / 2},${b.y - 24})`}>
                <rect width={w} height={48} rx={8} />
                <circle cx={16} cy={18} r={5} className={`state ${s}`} />
                <text x={28} y={22} className="svc-name">
                  {b.name}
                </text>
                <text x={14} y={39} className="svc-role">
                  {b.role}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="legend inline">
          <li>
            <span className="swatch live" /> MQTT, cada uno con su usuario
          </li>
          <li>
            <span className="dot-state online" /> en marcha
          </li>
          <li>
            <span className="dot-state offline" /> caído (Last Will en el broker)
          </li>
          <li>
            <span className="dot-state unknown" /> no publica su estado
          </li>
        </ul>
      </Card>
      <div className="arch-notes">
        <Card title="Por qué así">
          <ul className="plain">
            <li>El PLC simulado solo está en la red de campo. Para leerlo hay que pasar por plc-gateway, que no sabe escribir.</li>
            <li>Robot, pasarela y simulador hacen de frontera entre campo y UNS: cada uno solo deja pasar lo suyo.</li>
            <li>Nadie llama a nadie: todo pasa por el broker. Añadir un segundo robot es publicar en otra rama del UNS.</li>
            <li>La base de datos está aislada: el historiador escribe, Grafana solo lee.</li>
          </ul>
        </Card>
        <Card title="Lo que viaja por el UNS">
          <ul className="plain">
            <li>
              <b>planta1/exterior, tanques, calderas…</b> valores de proceso, del PLC o de la visión
            </li>
            <li>
              <b>planta1/robots/robot-01</b> posición, fotos y misiones
            </li>
            <li>
              <b>planta1/reglas</b> alarmas, con los valores que las decidieron
            </li>
            <li>
              <b>planta1/servicios</b> estado de cada servicio y sus diagnósticos
            </li>
            <li>
              <b>planta1/simulacion</b> solo de la demo: escenario y botón
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Zone({ x = 10, y, w = 980, h, label, note, closed = false }: { x?: number; y: number; w?: number; h: number; label: string; note: string; closed?: boolean }) {
  return (
    <g className={`zone ${closed ? "closed" : ""}`}>
      <rect x={x} y={y} width={w} height={h} rx={10} />
      <text x={x + 12} y={y + h - 10} className="zone-label">
        Red {label}
      </text>
      <text x={x + w - 12} y={y + h - 10} className="zone-note" textAnchor="end">
        {note}
      </text>
    </g>
  );
}
