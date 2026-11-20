// A small SVG chart: lines and dots over time, with threshold lines. Enough for the
// trends of a plant; no chart library for two charts.

export interface Series {
  points: [number, number][];
  color: string;
  label: string;
  dots?: boolean;
}

interface Props {
  series: Series[];
  x: [number, number];
  y: [number, number];
  lines?: { y: number; label: string; color: string }[];
  cursor?: number;
  xLabel?: (x: number) => string;
  width?: number; // in chart units: a wider chart keeps its text the same size
  height?: number;
}

const PAD = { left: 40, right: 12, top: 12, bottom: 24 };

export function Chart({ series, x, y, lines = [], cursor, xLabel = (v) => v.toFixed(0), width = 640, height = 220 }: Props) {
  const W = width;
  const H = height;
  const sx = (v: number) => PAD.left + ((v - x[0]) / (x[1] - x[0] || 1)) * (W - PAD.left - PAD.right);
  const sy = (v: number) => H - PAD.bottom - ((v - y[0]) / (y[1] - y[0] || 1)) * (H - PAD.top - PAD.bottom);
  const yTicks = ticks(y[0], y[1], 5);
  const xTicks = ticks(x[0], x[1], 6);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={PAD.left - 6} y={sy(t) + 4} textAnchor="end" className="tick">
            {t}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - 6} textAnchor={sx(t) > W - PAD.right - 20 ? "end" : "middle"} className="tick">
          {xLabel(t)}
        </text>
      ))}
      {lines.map((l) => (
        <g key={l.label}>
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(l.y)} y2={sy(l.y)} stroke={l.color} strokeDasharray="5 4" />
          <text x={W - PAD.right - 4} y={sy(l.y) - 4} textAnchor="end" className="tick" fill={l.color}>
            {l.label}
          </text>
        </g>
      ))}
      {series.map((s) =>
        s.dots ? (
          <g key={s.label} fill={s.color}>
            {s.points
              .filter(([t]) => t >= x[0] && t <= x[1])
              .map(([t, v]) => (
                <circle key={t} cx={sx(t)} cy={sy(v)} r={4} />
              ))}
          </g>
        ) : (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            points={s.points
              .filter(([t]) => t >= x[0] - 5 && t <= x[1] + 5)
              .map(([t, v]) => `${sx(t).toFixed(1)},${sy(v).toFixed(1)}`)
              .join(" ")}
          />
        ),
      )}
      {cursor !== undefined && (
        <line x1={sx(cursor)} x2={sx(cursor)} y1={PAD.top} y2={H - PAD.bottom} className="cursor" />
      )}
      <g className="legend">
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(${PAD.left + 8 + i * 150}, ${PAD.top + 6})`}>
            <rect width={10} height={10} y={-8} rx={2} fill={s.color} />
            <text x={16} y={1} className="tick">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function ticks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Number(t.toFixed(6)));
  return out;
}
