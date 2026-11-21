// The robot's round as a small wheel: the stop it has done, the one it is heading to,
// the one after; turning a place each time it gets somewhere.

import { payloadOf, useLive } from "../live";
import type { Plant, Point } from "../plant";
import { T } from "../topics";

const STEP = 6; // degrees between two stops on the wheel
const R = 3000;
const CX = 500;
const TOP = 30;
const HALF = 4; // stops placed on each side, for the turn; only one each side is seen
const EDGE = 1.6; // where the track ends

const at = (offset: number): Point => {
  const a = (offset * STEP * Math.PI) / 180;
  return [CX + R * Math.sin(a), TOP + R * (1 - Math.cos(a))];
};

function arc(from: number, to: number): string {
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2}`;
}

/** Where a point falls along the route, in metres from its start, and the route's length. */
function along(route: Point[], [px, py]: Point): { s: number; length: number } {
  let best = { d: Infinity, s: 0 };
  let s = 0;
  for (let i = 0; i < route.length; i++) {
    const [ax, ay] = route[i];
    const [bx, by] = route[(i + 1) % route.length];
    const len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py);
    if (d < best.d) best = { d, s: s + t * len };
    s += len;
  }
  return { s: best.s, length: s };
}

export function RouteWheel({ plant }: { plant: Plant }) {
  const live = useLive();
  const pose = payloadOf(live.get(T.pose));
  const stops = plant.paradas;
  const n = stops.length;
  const robot: Point = [typeof pose.x === "number" ? pose.x : plant.ruta[0][0], typeof pose.y === "number" ? pose.y : plant.ruta[0][1]];
  const here = stops.findIndex((s) => Math.hypot(s.punto[0] - robot[0], s.punto[1] - robot[1]) < 1.5);
  const target = stops.findIndex((s) => s.equipo === pose.destino);
  // Heading somewhere: that is the next stop. Standing at one: that stop is the present.
  const next = target >= 0 ? target : here >= 0 ? here : 0;
  const prev = (next - 1 + n) % n;

  const { s: sRobot, length } = along(plant.ruta, robot);
  const sPrev = along(plant.ruta, stops[prev].punto).s;
  const sNext = along(plant.ruta, stops[next].punto).s;
  const span = (sNext - sPrev + length) % length || length;
  const left = target >= 0 ? (sNext - sRobot + length) % length : 0;
  const progress = target >= 0 ? Math.max(0, Math.min(1, 1 - left / span)) : 1;
  const now = -1 + progress;
  const [nx, ny] = at(now);

  return (
    <svg className="route-wheel" viewBox="0 0 1000 80" role="img" aria-label={`Ronda del robot: siguiente parada ${stops[next].equipo}`}>
      <path d={arc(-EDGE, EDGE)} className="wheel-track" />
      <path d={arc(-EDGE, now)} className="wheel-done" />
      {stops.map((stop, i) => {
        const offset = ((i - next + n + HALF) % n) - HALF;
        const [x, y] = at(offset);
        const state = offset < 0 ? "past" : offset === 0 ? "next" : "future";
        const far = Math.abs(offset) > 1;
        return (
          <g key={stop.equipo} className={`wheel-stop ${state}`} style={{ transform: `translate(${x}px, ${y}px)`, opacity: far ? 0 : 1 }}>
            <circle r={offset === 0 ? 7 : 5} />
            <text y={-16}>{stop.equipo}</text>
          </g>
        );
      })}
      <line x1={nx} y1={ny - 9} x2={nx} y2={ny + 9} className="wheel-now" />
    </svg>
  );
}
