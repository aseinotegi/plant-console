// The robot's round, in a corner of the map: the stop it has done, the one it is
// heading to and the one after, sliding a place each time it gets somewhere.

import { payloadOf, useLive } from "../live";
import type { Plant, Point } from "../plant";
import { T } from "../topics";

const HALF = 4; // stops placed on each side, for the slide; only one each side is seen

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

/** The way from where the robot is to a point on the route: forwards, or the shorter
 * way round when it is on a mission (it may then walk backwards). */
export function wayTo(route: Point[], from: Point, to: Point, shortest: boolean): Point[] {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    cum.push(total);
    const [ax, ay] = route[i];
    const [bx, by] = route[(i + 1) % route.length];
    total += Math.hypot(bx - ax, by - ay);
  }
  const a = along(route, from).s;
  const b = along(route, to).s;
  const forward = (b - a + total) % total;
  const backward = total - forward;
  const ahead = !shortest || forward <= backward;
  const ways: Point[] = [from];
  const vertices = cum.map((s, i) => ({ s, p: route[i] }));
  if (ahead) {
    const inside = vertices.filter((v) => (v.s - a + total) % total < forward && (v.s - a + total) % total > 0);
    inside.sort((x, y) => ((x.s - a + total) % total) - ((y.s - a + total) % total));
    ways.push(...inside.map((v) => v.p));
  } else {
    const inside = vertices.filter((v) => (a - v.s + total) % total < backward && (a - v.s + total) % total > 0);
    inside.sort((x, y) => ((a - x.s + total) % total) - ((a - y.s + total) % total));
    ways.push(...inside.map((v) => v.p));
  }
  ways.push(to);
  return ways;
}

export function RouteBar({ plant }: { plant: Plant }) {
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

  // A frame in the free band at the bottom of the map, between the robot's base and the workshop.
  const w = plant.ancho * 0.52;
  const h = 3.4;
  const x0 = plant.ancho * 0.2;
  const y0 = plant.alto - h - 0.4;
  const gap = w * 0.36; // between two stops
  const cx = x0 + w / 2;
  const line = y0 + h * 0.68;
  const xAt = (offset: number) => cx + offset * gap;
  const now = xAt(-1 + progress);

  return (
    <g className="route-bar" pointerEvents="none" aria-label={`Ronda: siguiente parada ${stops[next].equipo}`}>
      <defs>
        <clipPath id="route-bar-clip">
          <rect x={x0} y={y0} width={w} height={h} rx={0.5} />
        </clipPath>
      </defs>
      <rect x={x0} y={y0} width={w} height={h} rx={0.5} className="route-frame" />
      <g clipPath="url(#route-bar-clip)">
        <line x1={x0 + 1} y1={line} x2={x0 + w - 1} y2={line} className="route-track" />
        <line x1={x0 + 1} y1={line} x2={now} y2={line} className="route-done" />
        {stops.map((stop, i) => {
          const offset = ((i - next + n + HALF) % n) - HALF;
          const state = offset < 0 ? "past" : offset === 0 ? "next" : "future";
          return (
            <g key={stop.equipo} className={`route-stop ${state}`} style={{ transform: `translate(${xAt(offset)}px, ${line}px)`, opacity: Math.abs(offset) > 1 ? 0 : 1 }}>
              <circle r={offset === 0 ? 0.42 : 0.32} />
              <text y={-0.85}>{stop.equipo}</text>
            </g>
          );
        })}
        <line x1={now} y1={line - 0.55} x2={now} y2={line + 0.55} className="route-now" />
      </g>
    </g>
  );
}
