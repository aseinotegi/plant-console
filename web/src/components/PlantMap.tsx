// The plant seen from above, in metres. The robot is drawn where it says it is
// (planta1/robots/robot-01/posicion); the instruments show their last UNS value.

import { type ReactNode, useRef } from "react";
import { num } from "../format";
import { payloadOf, useLive } from "../live";
import type { Plant, Point } from "../plant";
import { HIGH_BAR, T } from "../topics";

const GAUGE_MAX = 10; // bar, full scale of PI-104

export function PlantMap({ plant }: { plant: Plant }) {
  const live = useLive();
  const pose = payloadOf(live.get(T.pose));
  const pi = payloadOf(live.get(T.pi104));
  const pt = payloadOf(live.get(T.pt104));
  const alarm = payloadOf(live.get(T.pt104Alarm)).value === true;
  const valve = payloadOf(live.get(T.xv104)).value;
  const ext = payloadOf(live.get(T.ext12));
  const target = typeof pose.destino === "string" ? pose.destino : null;
  const state = typeof pose.value === "string" ? pose.value : "";
  const mission = state === "en-mision" || state === "actuando" ? target : null;
  const x = typeof pose.x === "number" ? pose.x : plant.ruta[0][0];
  const y = typeof pose.y === "number" ? pose.y : plant.ruta[0][1];
  const heading = useUnwrapped(typeof pose.rumbo === "number" ? pose.rumbo : 270);
  const device = (id: string) => plant.equipos.find((e) => e.id === id);
  const looking = state === "inspeccionando" || state === "comprobando" || state === "actuando" ? target ?? nearestStop(plant, x, y) : null;
  const seen = looking ? device(looking) : undefined;
  const hot = typeof pt.value === "number" && pt.value > HIGH_BAR;
  const base = device("BASE-1");
  const charging = !!base && Math.hypot(x - base.x, y - base.y) < 1.2 && state === "en-ruta";
  const pad = 1.5;

  return (
    <svg className="plant" viewBox={`${-pad} ${-pad} ${plant.ancho + 2 * pad} ${plant.alto + 2 * pad}`} role="img" aria-label={plant.nombre}>
      <defs>
        <marker id="flow" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.9" markerHeight="0.9" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className={hot ? "flow hot" : "flow"} />
        </marker>
      </defs>

      {plant.zonas.map((z) => (
        <g key={z.id} className="zone">
          <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} rx={0.6} />
          <text x={z.x + 0.6} y={z.y + z.alto - 0.6}>
            {z.nombre}
          </text>
        </g>
      ))}

      {plant.tuberias.map((p) => (
        <g key={p.id}>
          <line x1={p.desde[0]} y1={p.desde[1]} x2={p.hasta[0]} y2={p.hasta[1]} className={hot ? "pipe hot" : "pipe"} />
          <polyline points={flowPoints(p.desde, p.hasta)} className="pipe-flow" markerMid="url(#flow)" />
        </g>
      ))}

      {plant.equipos
        .filter((e) => e.cable)
        .map((e) => {
          const to = device(e.cable!);
          return to ? <polyline key={`c${e.id}`} className="cable" points={`${e.x},${e.y} ${e.x},${to.y} ${to.x},${to.y}`} /> : null;
        })}

      <polygon className="route" points={plant.ruta.map((p) => p.join(",")).join(" ")} />
      {plant.paradas.map((s) => (
        <g key={s.equipo} className={`stop ${target === s.equipo ? "target" : ""}`} transform={`translate(${s.punto[0]},${s.punto[1]})`}>
          <circle r={0.75} />
          <text y={0.4}>{s.accion === "foto" ? "📷" : "⚙"}</text>
        </g>
      ))}

      {plant.equipos.map((e) => {
        const g = (children: ReactNode, cls = "") => (
          <g key={e.id} className={`device ${cls}`} transform={`translate(${e.x},${e.y})`}>
            {mission === e.id && <circle r={2.6} className="pulse" />}
            {children}
          </g>
        );
        switch (e.tipo) {
          case "plc":
            return g(
              <>
                <rect x={-1.8} y={-1.3} width={3.6} height={2.6} rx={0.3} />
                <circle cx={-1} cy={-0.5} r={0.25} className={alarm ? "led bad" : "led ok"} />
                <circle cx={-0.2} cy={-0.5} r={0.25} className="led ok" />
                <text y={0.9} className="label">{e.id}</text>
                <text y={3} className="value">{alarm ? "ALARMA ALTA" : "S7 · DB1"}</text>
              </>,
              alarm ? "alarm" : "",
            );
          case "transmisor":
            return g(
              <>
                <line y1={0} y2={-1.6} className="stem" />
                <circle cy={-2.4} r={0.9} />
                <text y={-2.05} className="label small">PT</text>
                <text y={-4} className="value">{num(pt.value)} bar</text>
                <text y={2.4} className="name">{e.id}</text>
              </>,
              hot ? "alarm" : "",
            );
          case "manometro": {
            const v = typeof pi.value === "number" ? pi.value : null;
            const angle = v === null ? -135 : -135 + (Math.min(v, GAUGE_MAX) / GAUGE_MAX) * 270;
            const good = pi.quality === "good";
            return g(
              <>
                <line y1={0} y2={-1.2} className="stem" />
                <circle cy={-2.6} r={1.4} />
                <line x1={0} y1={-2.6} x2={0} y2={-3.6} className={`needle ${good ? "" : "stale"}`} transform={`rotate(${angle} 0 -2.6)`} />
                <text y={-4.6} className="value">{v === null ? "—" : `${num(v, 2)} bar`}</text>
                <text y={2.4} className="name">{e.id}</text>
              </>,
              v !== null && v > HIGH_BAR ? "alarm" : "",
            );
          }
          case "valvula": {
            const closed = valve === "cerrada";
            return g(
              <>
                <path d="M-1.2,-0.8 L1.2,0.8 L1.2,-0.8 L-1.2,0.8 Z" className={closed ? "valve closed" : "valve"} />
                <line y1={0} y2={-1.6} className="stem" />
                <line x1={-0.8} x2={0.8} y1={-1.6} y2={-1.6} className="stem" />
                <text y={-2.4} className="value">{closed ? "CERRADA" : typeof valve === "string" ? valve : "—"}</text>
                <text y={2.4} className="name">{e.id}</text>
              </>,
              closed ? "warn" : "",
            );
          }
          case "extintor": {
            const nok = ext.value === "NOK";
            return g(
              <>
                <rect x={-0.6} y={-1.2} width={1.2} height={2.4} rx={0.5} className={nok ? "ext nok" : "ext"} />
                <text y={-1.8} className="value">{typeof ext.value === "string" ? ext.value : "—"}</text>
                <text x={1.4} y={0.4} className="name start">{e.id}</text>
              </>,
              nok ? "alarm" : "",
            );
          }
          case "base":
            return g(
              <>
                <rect x={-1.6} y={-1} width={3.2} height={2} rx={0.3} className={charging ? "base charging" : "base"} />
                <path d="M0.3,-0.8 L-0.5,0.1 L0.1,0.1 L-0.3,0.8 L0.6,-0.2 L0,-0.2 Z" className={charging ? "bolt on" : "bolt"} />
              </>,
            );
          default:
            return g(<circle r={0.8} />);
        }
      })}

      {seen && <polygon className="fov" points={`${x},${y} ${seen.x - 1.2},${seen.y} ${seen.x + 1.2},${seen.y}`} />}

      <g className={`robot ${state}`} style={{ transform: `translate(${x}px, ${y}px) rotate(${heading}deg)` }}>
        <rect x={-1.3} y={-0.85} width={2.6} height={1.7} rx={0.4} />
        <path d="M1.3,-0.5 L1.9,0 L1.3,0.5 Z" className="nose" />
        <circle cx={0.6} cy={0} r={0.3} className="cam" />
      </g>
    </svg>
  );
}

function flowPoints(a: Point, b: Point): string {
  const n = 6;
  return Array.from({ length: n + 1 }, (_, i) => `${a[0] + ((b[0] - a[0]) * i) / n},${a[1] + ((b[1] - a[1]) * i) / n}`).join(" ");
}

function nearestStop(plant: Plant, x: number, y: number): string | null {
  let best: string | null = null;
  let d = 1.5;
  for (const s of plant.paradas) {
    const dist = Math.hypot(s.punto[0] - x, s.punto[1] - y);
    if (dist < d) [best, d] = [s.equipo, dist];
  }
  return best;
}

/** Keeps the heading continuous (350° → 10° turns 20°, not -340°), so the CSS transition turns the short way. */
function useUnwrapped(deg: number): number {
  const ref = useRef(deg);
  const delta = ((((deg - ref.current) % 360) + 540) % 360) - 180;
  ref.current += delta;
  return ref.current;
}
