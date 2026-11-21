import { useEffect, useState } from "react";
import { Badge, Card, Row } from "../components/bits";
import { Chart, type Series } from "../components/Chart";
import { DisturbanceButton } from "../components/Disturbance";
import { ago, dec, show } from "../format";
import { live as store, payloadOf, stamp, summary, useLive, useNow } from "../live";
import { CLEAR_BAR, DB1, HIGH_BAR, T } from "../topics";
import { useServices, Zone } from "./ArchitecturePage";

interface Scenario {
  fase_s: number;
  ciclo_s: number;
  perturbacion_s: number;
  valvula_cerrada: boolean;
  perfil: [number, number][];
}

const WINDOW_S = 300;
const TRENDS = [T.pt104, T.pi104, T.ft104, T.tt104, T.lt101, T.p104Current];

export function PlcPage() {
  const live = useLive();
  const now = useNow();
  const scenario = useScenario();
  useEffect(() => {
    for (const t of TRENDS) store.backfill(t);
  }, []);
  const trend = (topic: string) => relative(live.trends.get(topic) ?? [], now);
  const gateway = [...live.topics.values()].filter((e) => e.topic.startsWith(`${T.services}plc-gateway`));
  const anyAlarm = DB1.some((t) => t.type === "BOOL" && t.name.startsWith("Alarma") && payloadOf(live.get(t.topic)).value === true);

  const chart = (series: Series[], y: [number, number], lines: { y: number; label: string; color: string }[] = []) => (
    <Chart series={series} x={[-WINDOW_S, 0]} y={y} lines={lines} xLabel={(t) => (t === 0 ? "ahora" : `${t} s`)} height={190} />
  );

  return (
    <div className="plc-page">
      <section className="card plc-path-card">
        <PlcPath />
      </section>
      <Card title="PLC-1, Siemens S7 simulado" aside={<Badge tone={anyAlarm ? "bad" : "ok"}>{anyAlarm ? "Con alarmas" : "Sin alarmas"}</Badge>}>
        <table className="tags">
          <thead>
            <tr>
              <th>Dirección</th>
              <th>Tipo</th>
              <th>Señal</th>
              <th className="num">Valor</th>
              <th>Último cambio</th>
            </tr>
          </thead>
          <tbody>
            {DB1.map((t) => {
              const e = live.get(t.topic);
              const p = payloadOf(e);
              const bool = t.type === "BOOL";
              return (
                <tr key={t.address} title={t.topic}>
                  <td className="addr">{t.address}</td>
                  <td>{t.type}</td>
                  <td>
                    <b>{t.tag}</b> {t.name}
                  </td>
                  <td className="num">
                    {bool ? (
                      <Badge tone={p.value ? (t.name.startsWith("Alarma") ? "bad" : "ok") : "idle"}>{p.value ? "1" : "0"}</Badge>
                    ) : t.type === "INT" ? (
                      show(p.value)
                    ) : (
                      `${dec(p.value, 2)} ${typeof p.unit === "string" ? p.unit : ""}`
                    )}
                  </td>
                  <td className="muted">{ago(stamp(e), now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {gateway.map((g) => (
          <Row key={g.topic} label={g.topic.slice(T.services.length)}>
            <span className="small ellipsis" title={JSON.stringify(g.payload)}>
              {summary(g)}
            </span>
          </Row>
        ))}
      </Card>

      <Card title="Escenario" aside={<DisturbanceButton />}>
        {scenario ? (
          <>
            <Chart
              series={[{ points: scenario.perfil, color: "var(--soft)", label: "presión de entrada, bar" }]}
              x={[0, scenario.ciclo_s]}
              y={[3.5, 9]}
              lines={[{ y: HIGH_BAR, label: "6,0", color: "var(--bad)" }]}
              cursor={scenario.fase_s}
              xLabel={(t) => `${Math.round(t)} s`}
              height={170}
            />
            <Row label="Válvula XV-104">{scenario.valvula_cerrada ? "cerrada" : "abierta"}</Row>
          </>
        ) : (
          <p className="muted">Esperando al simulador…</p>
        )}
      </Card>

      <div className="trend-grid">
        <Card title="Presión, línea 104">
          {chart(
            [
              { points: trend(T.pt104), color: "var(--accent)", label: "PT-104, PLC" },
              { points: trend(T.pi104), color: "var(--alarm)", label: "PI-104, visión", dots: true },
            ],
            [3.5, 9],
            [
              { y: HIGH_BAR, label: "dispara 6,0", color: "var(--bad)" },
              { y: CLEAR_BAR, label: "rearma 5,5", color: "var(--soft)" },
            ],
          )}
        </Card>
        <Card title="Caudal FT-104, m³/h">{chart([{ points: trend(T.ft104), color: "var(--accent)", label: "caudal" }], [0, 60])}</Card>
        <Card title="Nivel T-101, %">
          {chart([{ points: trend(T.lt101), color: "var(--accent)", label: "nivel" }], [0, 100], [
            { y: 90, label: "alarma 90", color: "var(--bad)" },
            { y: 70, label: "arranca P-104", color: "var(--soft)" },
            { y: 35, label: "para P-104", color: "var(--soft)" },
          ])}
        </Card>
        <Card title="Motor P-104, A">{chart([{ points: trend(T.p104Current), color: "var(--accent)", label: "corriente" }], [0, 120])}</Card>
      </div>
    </div>
  );
}

const relative = (points: [number, number][], now: number): [number, number][] => points.map(([t, v]) => [t - now, v]);

function useScenario(): Scenario | null {
  const [s, setS] = useState<Scenario | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/escenario");
        if (r.ok && alive) setS(await r.json());
      } catch {
        /* the simulator may be restarting */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return s;
}

/** Where the PLC sits and how its data reaches the broker, drawn like the architecture page. */
function PlcPath() {
  const services = useServices();
  const state = (id: string) => services.find((x) => x.nombre === id)?.estado ?? "sin-datos";
  const boxes = [
    { id: "world", name: "PLC-1", role: "S7 · DB1 · python-snap7", x: 165 },
    { id: "", name: "SCALANCE SC-600", role: "firewall OT / IT", x: 390, fw: true },
    { id: "plc-gateway", name: "plc-mqtt-gateway", role: "cliente S7 → MQTT", x: 625 },
    { id: "broker", name: "Mosquitto", role: "UNS", x: 865, hub: true },
  ];
  const w = 190;
  return (
    <svg viewBox="0 0 1000 132" className="arch plc-path" role="img" aria-label="Del PLC al broker">
      <Zone y={8} h={116} w={300} label="campo" />
      <Zone x={480} y={8} h={116} w={510} label="uns" />
      {[["S7comm", 165, 390, "other"], ["", 390, 625, "other"], ["MQTT", 625, 865, "mqtt"]].map(([label, a, b, kind]) => (
        <g key={String(a)} className={`link ${kind}`}>
          <line x1={Number(a)} y1={58} x2={Number(b)} y2={58} />
          {label && <text x={(Number(a) + Number(b)) / 2} y={52}>{label}</text>}
        </g>
      ))}
      {boxes.map((b) => (
        <g key={b.name} className={`svc ${b.hub ? "hub" : ""} ${b.fw ? "fw" : ""} ${b.id ? `st-${state(b.id)}` : ""}`} transform={`translate(${b.x - w / 2},36)`}>
          {b.fw && <title>Referencia de planta; en la demo lo hacen las redes Docker</title>}
          <rect width={w} height={44} rx={8} />
          {b.id && <circle cx={16} cy={22} r={5} className={`state ${state(b.id)}`} />}
          <text x={b.id ? 28 : 14} y={20} className="svc-name">{b.name}</text>
          <text x={b.id ? 28 : 14} y={35} className="svc-role">{b.role}</text>
        </g>
      ))}
    </svg>
  );
}
