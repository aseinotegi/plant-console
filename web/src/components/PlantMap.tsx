// The plant seen from above, in metres, drawn like a control-room overview: equipment
// in quiet greys, colour only where something is live (cyan) or wrong (amber, red).
// Everything comes from the robot's map (config/planta.yaml) and the UNS: the robot is
// where it says it is, every instrument shows its last value.

import { useRef } from "react";
import { dec } from "../format";
import { type Entry, payloadOf, useLive } from "../live";
import type { Device, Plant, Point, Zone } from "../plant";
import { HIGH_BAR, T } from "../topics";

interface Props {
  plant: Plant;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const PAD = 2.5;

export function PlantMap({ plant, selected, onSelect }: Props) {
  const live = useLive();
  const pose = payloadOf(live.get(T.pose));
  const state = typeof pose.value === "string" ? pose.value : "";
  const target = typeof pose.destino === "string" ? pose.destino : null;
  const mission = state === "en-mision" || state === "actuando" ? target : null;
  const start = plant.ruta[0];
  const x = typeof pose.x === "number" ? pose.x : start[0];
  const y = typeof pose.y === "number" ? pose.y : start[1];
  const heading = useUnwrapped(typeof pose.rumbo === "number" ? pose.rumbo : -90);
  const device = (id: string) => plant.equipos.find((e) => e.id === id);

  const flowing = num(live.get(T.ft104)) > 1;
  const pumping = payloadOf(live.get(T.p104Run)).value === true;
  const hot = num(live.get(T.pt104)) > HIGH_BAR;
  const looking = ["inspeccionando", "comprobando", "actuando"].includes(state) ? nearestStop(plant, x, y) : null;
  const seen = looking ? device(looking) : undefined;
  const W = plant.ancho;
  const H = plant.alto;

  return (
    <svg
      className="plant"
      viewBox={`${-PAD} ${-PAD} ${W + 2 * PAD} ${H + 2 * PAD}`}
      role="img"
      aria-label={`Plano de ${plant.nombre}`}
      onClick={() => onSelect(null)}
    >
      <defs>
        <pattern id="grid1" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M1 0H0V1" className="grid-minor" />
        </pattern>
        <pattern id="grid5" width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="url(#grid1)" />
          <path d="M5 0H0V5" className="grid-major" />
        </pattern>
        <pattern id="hatch" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.8" className="hatch" />
        </pattern>
      </defs>

      <rect x={0} y={0} width={W} height={H} className="floor" />
      <rect x={0} y={0} width={W} height={H} fill="url(#grid5)" />
      <Rulers w={W} h={H} />

      {plant.zonas.map((z) => (
        <ZoneShape key={z.id} zone={z} />
      ))}

      <Walkway points={plant.ruta} />

      {plant.tuberias.map((p) => {
        const moving = p.linea === "nitrogeno" ? false : p.id === "linea-104" ? flowing : pumping;
        return <Pipe key={p.id} points={p.puntos} kind={p.linea} moving={moving} hot={p.id === "linea-104" && hot} label={p.nombre} />;
      })}

      {plant.paradas.map((s) => (
        <StopMark key={s.equipo} point={s.punto} action={s.accion} next={target === s.equipo} />
      ))}

      {plant.equipos.map((e) => (
        <g
          key={e.id}
          className={`device ${selected === e.id ? "selected" : ""}`}
          transform={`translate(${e.x},${e.y})`}
          onClick={(ev) => {
            ev.stopPropagation();
            onSelect(e.id);
          }}
        >
          <title>{`${e.id} · ${e.nombre}`}</title>
          {mission === e.id && <circle r={2.4} className="mission-ring" />}
          <Equipment device={e} live={live} charging={state === "cargando"} />
          {selected === e.id && <rect x={-2.6} y={-2.6} width={5.2} height={5.2} rx={0.4} className="select-box" />}
        </g>
      ))}

      <TargetMark plant={plant} target={target} mission={!!mission} />

      <Trail points={live.trail} />
      {seen && <polygon className="fov" points={fov([x, y], [seen.x, seen.y])} />}

      <g className={`robot ${state}`} style={{ transform: `translate(${x}px, ${y}px) rotate(${heading}deg)` }}>
        <circle r={0.9} className="lidar" />
        <rect x={-0.55} y={-0.62} width={0.32} height={0.24} rx={0.08} className="foot" />
        <rect x={-0.55} y={0.38} width={0.32} height={0.24} rx={0.08} className="foot" />
        <rect x={0.35} y={-0.62} width={0.32} height={0.24} rx={0.08} className="foot" />
        <rect x={0.35} y={0.38} width={0.32} height={0.24} rx={0.08} className="foot" />
        <rect x={-0.85} y={-0.45} width={1.7} height={0.9} rx={0.28} className="body" />
        <rect x={0.62} y={-0.22} width={0.45} height={0.44} rx={0.1} className="head" />
        <circle cx={0.95} cy={0} r={0.1} className="lens" />
      </g>

      <ScaleBar y={H + 1.2} />
    </svg>
  );
}

// -- floor plan ---------------------------------------------------------------------

function Rulers({ w, h }: { w: number; h: number }) {
  const xs = Array.from({ length: Math.floor(w / 10) + 1 }, (_, i) => i * 10);
  const ys = Array.from({ length: Math.floor(h / 10) + 1 }, (_, i) => i * 10);
  return (
    <g className="ruler">
      {xs.map((v) => (
        <text key={`x${v}`} x={v} y={-0.7}>
          {v}
        </text>
      ))}
      {ys.map((v) => (
        <text key={`y${v}`} x={-0.8} y={v + 0.3} textAnchor="end">
          {v}
        </text>
      ))}
    </g>
  );
}

function ZoneShape({ zone: z }: { zone: Zone }) {
  const [lx, ly] = z.rotulo ?? [z.x + 0.7, z.y + 1.5];
  const label = (
    <text x={lx} y={ly} className="zone-name">
      {z.nombre}
    </text>
  );
  if (z.tipo === "edificio") {
    return (
      <g className="building">
        <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} />
        {(z.puertas ?? []).map(([px, py]) => {
          const vertical = Math.abs(px - z.x) < 0.01 || Math.abs(px - z.x - z.ancho) < 0.01;
          return vertical ? (
            <line key={`${px},${py}`} x1={px} x2={px} y1={py - 1} y2={py + 1} className="door" />
          ) : (
            <line key={`${px},${py}`} x1={px - 1} x2={px + 1} y1={py} y2={py} className="door" />
          );
        })}
        {label}
      </g>
    );
  }
  if (z.tipo === "cubeto") {
    return (
      <g className="bund">
        <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} />
        <rect x={z.x + 0.35} y={z.y + 0.35} width={z.ancho - 0.7} height={z.alto - 0.7} className="inner" />
        {label}
      </g>
    );
  }
  if (z.tipo === "vallado") {
    return (
      <g className="fence">
        <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} fill="url(#hatch)" />
        <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} className="wire" />
        {label}
        <Danger x={z.x + z.ancho - 1.2} y={z.y + 1.2} />
      </g>
    );
  }
  return (
    <g className="area">
      <rect x={z.x} y={z.y} width={z.ancho} height={z.alto} />
      {label}
    </g>
  );
}

function Danger({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} className="danger">
      <path d="M0,-0.6 L0.6,0.45 L-0.6,0.45 Z" />
      <path d="M0.05,-0.3 L-0.12,0.05 L0.06,0.05 L-0.06,0.32" className="bolt" />
    </g>
  );
}

function Walkway({ points }: { points: Point[] }) {
  const d = points.map((p) => p.join(",")).join(" ");
  return (
    <g className="walkway">
      <polygon points={d} className="edge" />
      <polygon points={d} className="lane" />
      <polygon points={d} className="center" />
    </g>
  );
}

function Pipe({ points, kind, moving, hot, label }: { points: Point[]; kind: string; moving: boolean; hot: boolean; label?: string }) {
  const d = points.map((p) => p.join(",")).join(" ");
  const [a, b] = points;
  const horizontal = Math.abs(a[1] - b[1]) < 0.01;
  return (
    <g className={`pipe ${kind} ${hot ? "hot" : ""}`}>
      <polyline points={d} className="casing" />
      <polyline points={d} className="bore" />
      {moving && <polyline points={d} className="flow" />}
      {label && (
        <text
          x={horizontal ? Math.min(a[0], b[0]) + Math.abs(a[0] - b[0]) * 0.82 : a[0] + 0.7}
          y={horizontal ? a[1] - 0.7 : (a[1] + b[1]) / 2}
          className="pipe-name"
          textAnchor={horizontal ? "middle" : "start"}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function StopMark({ point: [x, y], action, next }: { point: Point; action: string; next: boolean }) {
  return (
    <g className={`stop ${next ? "next" : ""}`} transform={`translate(${x},${y})`}>
      <circle r={0.5} />
      {action === "foto" && <rect x={-0.22} y={-0.15} width={0.44} height={0.3} rx={0.05} className="glyph" />}
      {action === "valvula" && <path d="M-0.25,-0.18 L0.25,0.18 L0.25,-0.18 L-0.25,0.18 Z" className="glyph" />}
      {action === "carga" && <path d="M0.06,-0.28 L-0.14,0.04 L0.02,0.04 L-0.06,0.28 L0.16,-0.06 L0,-0.06 Z" className="glyph" />}
    </g>
  );
}

/** Where the robot is going: a ring on the walkway, and the name of the point. */
function TargetMark({ plant, target, mission }: { plant: Plant; target: string | null; mission: boolean }) {
  const stop = plant.paradas.find((s) => s.equipo === target);
  if (!stop || !target) return null;
  const [x, y] = stop.punto;
  const w = target.length * 0.82 + 1.4;
  return (
    <g className={`target-mark ${mission ? "mission" : ""}`} transform={`translate(${x},${y})`} pointerEvents="none">
      <circle r={1.2} className="target-ring" />
      <circle r={1.2} className="target-pulse" />
      <g transform="translate(0,-2.9)">
        <rect x={-w / 2} y={-0.85} width={w} height={1.7} rx={0.35} />
        <text y={0.45}>{target}</text>
      </g>
    </g>
  );
}

function Trail({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  return (
    <g className="trail">
      {points.slice(1).map((p, i) => (
        <line
          key={i}
          x1={points[i][0]}
          y1={points[i][1]}
          x2={p[0]}
          y2={p[1]}
          style={{ opacity: (i + 1) / points.length }}
        />
      ))}
    </g>
  );
}

function ScaleBar({ y }: { y: number }) {
  return (
    <g className="scale" transform={`translate(0,${y})`}>
      <rect x={0} y={-0.2} width={5} height={0.4} className="dark" />
      <rect x={5} y={-0.2} width={5} height={0.4} className="light" />
      <text x={0} y={1.1}>0</text>
      <text x={5} y={1.1}>5</text>
      <text x={10} y={1.1}>10 m</text>
    </g>
  );
}

// -- equipment ------------------------------------------------------------------------

function Equipment({ device: d, live, charging }: { device: Device; live: ReturnType<typeof useLive>; charging: boolean }) {
  const entry = d.senal ? live.get(d.senal) : undefined;
  const p = payloadOf(entry);
  switch (d.tipo) {
    case "plc":
      return (
        <>
          <rect x={-1.5} y={-0.8} width={3} height={1.6} rx={0.1} className="steel" />
          {[-1.15, -0.75, -0.35, 0.05, 0.45, 0.85].map((mx) => (
            <rect key={mx} x={mx} y={-0.6} width={0.3} height={1.2} className="module" />
          ))}
          <circle cx={1.25} cy={-0.5} r={0.1} className={live.get(T.pt104Alarm) && payloadOf(live.get(T.pt104Alarm)).value ? "led bad" : "led ok"} />
          <Tag y={1.6} text={d.id} />
        </>
      );
    case "puesto":
      return (
        <>
          <rect x={-1.6} y={-0.7} width={3.2} height={1.4} rx={0.1} className="desk" />
          <rect x={-1.2} y={-0.62} width={1.05} height={0.16} className="screen" />
          <rect x={0.15} y={-0.62} width={1.05} height={0.16} className="screen" />
          <circle cx={0} cy={1.1} r={0.35} className="steel" />
          <Tag y={2.1} text="SCADA" />
        </>
      );
    case "extintor":
      return <Extinguisher d={d} entry={entry} />;
    case "transformador":
      return (
        <>
          <rect x={-2.2} y={-1.8} width={4.4} height={3.6} rx={0.15} className="steel dark" />
          {[-1.6, -1.1, -0.6, -0.1, 0.4, 0.9, 1.4].map((fx) => (
            <line key={fx} x1={fx} x2={fx} y1={-2.2} y2={-1.8} className="fin" />
          ))}
          {[-1, 0, 1].map((bx) => (
            <circle key={bx} cx={bx} cy={-0.9} r={0.32} className="bushing" />
          ))}
          {[-1.2, -0.4, 0.4, 1.2].map((bx) => (
            <circle key={bx} cx={bx} cy={0.9} r={0.18} className="bushing" />
          ))}
          <Tag y={2.8} text={d.id} sub="20/0,4 kV" />
        </>
      );
    case "manometro":
      return <Gauge d={d} live={live} />;
    case "valvula": {
      const closed = p.value === "cerrada";
      return (
        <>
          <path d="M-0.8,-0.55 L0.8,0.55 L0.8,-0.55 L-0.8,0.55 Z" className={closed ? "valve closed" : "valve"} />
          <line y1={0} y2={-1.4} className="stem" />
          <circle cy={-1.9} r={0.55} className="handwheel" />
          <line x1={-0.55} x2={0.55} y1={-1.9} y2={-1.9} className="stem" />
          <line x1={0} x2={0} y1={-2.45} y2={-1.35} className="stem" />
          <Value y={-2.9} text={closed ? "Cerrada" : typeof p.value === "string" ? "Abierta" : "—"} tone={closed ? "warn" : ""} />
          <Tag y={1.6} text={d.id} />
        </>
      );
    }
    case "transmisor":
    case "caudalimetro": {
      const letters = d.letras ?? d.id.split("-")[0];
      const number = d.id.split("-")[1] ?? "";
      const value = typeof p.value === "number" ? `${dec(p.value, d.id === "LT-101" ? 0 : 1)} ${p.unit ?? ""}` : "—";
      const onPipe = d.id !== "LT-101";
      const tone = d.id === "PT-104" && num(entry) > HIGH_BAR ? "bad" : "";
      return (
        <>
          {d.tipo === "caudalimetro" && <rect x={-0.55} y={-0.42} width={1.1} height={0.84} className="element" />}
          {onPipe && <line y1={0} y2={-1.55} className="impulse" />}
          <g transform={`translate(0,${onPipe ? -2.3 : 0})`}>
            <circle r={0.78} className="bubble" />
            <text y={-0.08} className="isa">
              {letters}
            </text>
            <text y={0.5} className="isa small">
              {number}
            </text>
          </g>
          <Value y={onPipe ? -3.4 : -1.2} text={value} tone={tone} />
        </>
      );
    }
    case "tanque":
      return <Tank d={d} entry={entry} />;
    case "bomba":
      return <Pump d={d} live={live} />;
    case "caldera":
      return (
        <>
          <rect x={-3} y={-2.5} width={6} height={5} rx={1} className="steel" />
          <circle cx={-1.6} cy={0} r={0.9} className="burner" />
          <circle cx={1.9} cy={-1.5} r={0.55} className="chimney" />
          <Tag y={3.4} text="Caldera" />
        </>
      );
    case "compresor":
      return (
        <>
          <rect x={-1.6} y={-0.9} width={3.2} height={1.8} rx={0.15} className="steel idle" />
          <circle cx={1.6} cy={0} r={0.75} className="steel idle" />
          <Tag y={1.9} text="Compresor" sub="fuera de servicio" />
        </>
      );
    case "base":
      return (
        <>
          <rect x={-1.1} y={-0.7} width={2.2} height={1.4} rx={0.15} className={charging ? "dock charging" : "dock"} />
          <path d="M0.15,-0.5 L-0.3,0.08 L0.05,0.08 L-0.12,0.5 L0.35,-0.1 L0,-0.1 Z" className={charging ? "bolt on" : "bolt"} />
          <Tag y={1.6} text={charging ? "Cargando" : "Base"} />
        </>
      );
    default:
      return <circle r={0.6} className="steel" />;
  }
}

function Tag({ y, text, sub }: { y: number; text: string; sub?: string }) {
  return (
    <>
      <text y={y} className="tag">
        {text}
      </text>
      {sub && (
        <text y={y + 0.85} className="tag sub">
          {sub}
        </text>
      )}
    </>
  );
}

function Value({ y, text, tone = "" }: { y: number; text: string; tone?: string }) {
  return (
    <text y={y} className={`value ${tone}`}>
      {text}
    </text>
  );
}

function Gauge({ d, live }: { d: Device; live: ReturnType<typeof useLive> }) {
  const reading = payloadOf(live.get(`${d.senal}/inspeccion`));
  const value = typeof reading.value === "number" ? reading.value : null;
  const [lo, hi] = d.rango ?? [0, 10];
  const angle = value === null ? -135 : -135 + ((Math.min(Math.max(value, lo), hi) - lo) / (hi - lo)) * 270;
  const good = reading.quality === "good";
  const ticks = Array.from({ length: 11 }, (_, i) => -135 + i * 27);
  const alarm = d.id === "PI-104" && value !== null && value > HIGH_BAR;
  const text =
    reading.quality === undefined
      ? "sin foto"
      : value === null
        ? "no legible"
        : `${dec(value, 1)} ${d.unidad ?? ""}`;
  return (
    <>
      <circle r={0.85} className="dial" />
      {ticks.map((t) => (
        <line key={t} x1={0} y1={-0.62} x2={0} y2={-0.76} className="tick" transform={`rotate(${t})`} />
      ))}
      <line x1={0} y1={0.12} x2={0} y2={-0.62} className={`needle ${good ? "" : "stale"}`} transform={`rotate(${angle})`} />
      <circle r={0.1} className="hub" />
      <Value y={-1.3} text={text} tone={alarm ? "bad" : good ? "" : "warn"} />
      <Tag y={1.7} text={d.id} />
    </>
  );
}

function Extinguisher({ d, entry }: { d: Device; entry: Entry | undefined }) {
  const p = payloadOf(entry);
  const off = p.value === "NOK";
  return (
    <>
      <rect x={-0.35} y={-0.62} width={0.7} height={0.16} className="bracket" />
      {off ? (
        <g transform="translate(0.7,0.55) rotate(70)">
          <rect x={-0.28} y={-0.6} width={0.56} height={1.2} rx={0.25} className="ext-body" />
        </g>
      ) : (
        <circle cy={-0.1} r={0.34} className="ext-body" />
      )}
      <Value y={-1.05} text={off ? "Fuera de soporte" : p.value === "OK" ? "OK" : "—"} tone={off ? "warn" : ""} />
      <Tag y={off ? 2.1 : 1.5} text={d.id} />
    </>
  );
}

function Tank({ d, entry }: { d: Device; entry: Entry | undefined }) {
  const r = d.radio ?? 4;
  const level = num(entry);
  const circumference = 2 * Math.PI * (r - 0.35);
  const high = level > 90;
  return (
    <>
      <circle r={r} className="tank" />
      <circle r={r - 0.35} className="level-track" />
      <circle
        r={r - 0.35}
        className={`level ${high ? "high" : ""}`}
        strokeDasharray={`${(circumference * Math.max(0, Math.min(level, 100))) / 100} ${circumference}`}
        transform="rotate(-90)"
      />
      <circle r={0.6} cy={-r + 1.3} className="manhole" />
      <text y={0.1} className="tank-tag">
        {d.id}
      </text>
      <text y={1.3} className={`tank-level ${high ? "bad" : ""}`}>
        {Number.isFinite(level) ? `${dec(level, 0)} %` : "—"}
      </text>
    </>
  );
}

function Pump({ d, live }: { d: Device; live: ReturnType<typeof useLive> }) {
  const running = payloadOf(live.get(T.p104Run)).value === true;
  const amps = num(live.get(T.p104Current));
  return (
    <>
      <rect x={-2} y={-0.8} width={4} height={1.6} rx={0.1} className="skid" />
      <rect x={-1.8} y={-0.55} width={1.9} height={1.1} rx={0.25} className="motor" />
      {[-1.5, -1.2, -0.9, -0.6, -0.3].map((fx) => (
        <line key={fx} x1={fx} x2={fx} y1={-0.55} y2={0.55} className="fin" />
      ))}
      <rect x={0.1} y={-0.15} width={0.45} height={0.3} className="coupling" />
      <g transform="translate(1.2,0)">
        <circle r={0.6} className="volute" />
        <g className={running ? "impeller spin" : "impeller"}>
          <path d="M0,0 L0,-0.45 M0,0 L0.39,0.22 M0,0 L-0.39,0.22" />
        </g>
      </g>
      <Value y={-1.3} text={running ? `En marcha · ${dec(amps, 1)} A` : "Parada"} tone={running ? "live" : ""} />
      <Tag y={1.7} text={d.id} />
    </>
  );
}

// -- helpers ------------------------------------------------------------------------

function num(entry: Entry | undefined): number {
  const v = payloadOf(entry).value;
  return typeof v === "number" ? v : Number.NaN;
}

function nearestStop(plant: Plant, x: number, y: number): string | null {
  let best: string | null = null;
  let d = 1.5;
  for (const s of plant.paradas) {
    const dist = Math.hypot(s.punto[0] - x, s.punto[1] - y);
    if (dist < d && s.accion !== "carga") [best, d] = [s.equipo, dist];
  }
  return best;
}

function fov(from: Point, to: Point): string {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [(-dy / len) * 1.1, (dx / len) * 1.1];
  return `${from[0]},${from[1]} ${to[0] + nx},${to[1] + ny} ${to[0] - nx},${to[1] - ny}`;
}

/** Keeps the heading continuous (350° → 10° turns 20°, not -340°), so the CSS transition turns the short way. */
function useUnwrapped(deg: number): number {
  const ref = useRef(deg);
  const delta = ((((deg - ref.current) % 360) + 540) % 360) - 180;
  ref.current += delta;
  return ref.current;
}

