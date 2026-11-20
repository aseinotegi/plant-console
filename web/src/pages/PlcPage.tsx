import { useEffect, useState } from "react";
import { Badge, Card, Row } from "../components/bits";
import { Chart } from "../components/Chart";
import { DisturbanceButton } from "../components/Disturbance";
import { ago, num, show } from "../format";
import { live as store, payloadOf, stamp, summary, useLive, useNow } from "../live";
import { CLEAR_BAR, HIGH_BAR, T } from "../topics";

interface Scenario {
  fase_s: number;
  ciclo_s: number;
  perturbacion_s: number;
  valvula_cerrada: boolean;
  perfil: [number, number][];
}

const WINDOW_S = 300;

export function PlcPage() {
  const live = useLive();
  const now = useNow();
  const scenario = useScenario();
  useEffect(() => {
    store.backfill(T.pt104);
    store.backfill(T.pi104);
  }, []);

  const pt = live.get(T.pt104);
  const alarm = live.get(T.pt104Alarm);
  const gateway = [...live.topics.values()].filter((e) => e.topic.startsWith(`${T.services}plc-gateway`));
  const trendPt = live.trends.get(T.pt104) ?? [];
  const trendPi = live.trends.get(T.pi104) ?? [];

  return (
    <div className="page-grid">
      <Card title="PLC-1 · Siemens S7 simulado" aside={<Badge tone={alarm && payloadOf(alarm).value ? "bad" : "ok"}>{alarm && payloadOf(alarm).value ? "alarma alta" : "normal"}</Badge>}>
        <table className="tags">
          <thead>
            <tr>
              <th>Dirección</th>
              <th>Tipo</th>
              <th>Valor</th>
              <th>Tema del UNS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">DB1.DBD0</td>
              <td>REAL</td>
              <td className="mono">{num(payloadOf(pt).value, 3)} bar</td>
              <td className="mono small">{T.pt104}</td>
            </tr>
            <tr>
              <td className="mono">DB1.DBX4.0</td>
              <td>BOOL</td>
              <td className="mono">{show(payloadOf(alarm).value)}</td>
              <td className="mono small">{T.pt104Alarm}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          La pasarela plc-mqtt-gateway lee el bloque DB1 por S7 cada 200 ms y publica cada variable en su sitio del UNS. Es de solo lectura: el PLC no recibe órdenes de nadie.
        </p>
        {gateway.map((g) => (
          <Row key={g.topic} label={g.topic.slice(T.services.length)}>
            <span className="mono small ellipsis" title={JSON.stringify(g.payload)}>{summary(g)}</span>
            <span className="muted"> {ago(stamp(g), now)}</span>
          </Row>
        ))}
      </Card>

      <Card title="Cómo se generan las señales" aside={<DisturbanceButton />}>
        {scenario ? (
          <>
            <Chart
              series={[{ points: scenario.perfil, color: "var(--soft)", label: "perfil del escenario" }]}
              x={[0, scenario.ciclo_s]}
              y={[3.5, 7.5]}
              lines={[{ y: HIGH_BAR, label: "6.0", color: "var(--bad)" }]}
              cursor={scenario.fase_s}
              xLabel={(t) => `${Math.round(t)} s`}
              height={180}
            />
            <p className="muted small">
              El simulador repite este perfil (dataset/plc/linea-104.csv) cada {Math.round(scenario.ciclo_s)} s, con algo de ruido. La subida empieza en el segundo {Math.round(scenario.perturbacion_s)}. Si el robot cierra XV-104, la presión baja aunque el perfil siga arriba, y la válvula se vuelve a abrir para la siguiente perturbación.
            </p>
            <Row label="Válvula XV-104">{scenario.valvula_cerrada ? "cerrada" : "abierta"}</Row>
          </>
        ) : (
          <p className="muted">Esperando al simulador…</p>
        )}
      </Card>
      <Card title="Presión en la línea 104 · últimos 5 min" className="full">
        <Chart
          series={[
            { points: relative(trendPt, now), color: "var(--accent)", label: "PT-104 (PLC)" },
            { points: relative(trendPi, now), color: "var(--alarm)", label: "PI-104 (visión)", dots: true },
          ]}
          x={[-WINDOW_S, 0]}
          y={[3.5, 7.5]}
          lines={[
            { y: HIGH_BAR, label: "dispara 6.0", color: "var(--bad)" },
            { y: CLEAR_BAR, label: "rearma 5.5", color: "var(--soft)" },
          ]}
          xLabel={(t) => (t === 0 ? "ahora" : `${t} s`)}
          width={1280}
          height={260}
        />
        <p className="muted small">La línea es el transmisor leído por el PLC. Los puntos son lo que lee la visión en cada foto del manómetro. La regla solo actúa cuando los dos pasan de 6 bar.</p>
      </Card>

    </div>
  );
}

const relative = (points: [number, number][], now: number): [number, number][] =>
  points.map(([t, v]) => [t - now, v]);

function useScenario(): Scenario | null {
  const [s, setS] = useState<Scenario | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/escenario");
        if (r.ok && alive) setS(await r.json());
      } catch {
        /* the world may be restarting */
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
