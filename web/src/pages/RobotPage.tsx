import { useState } from "react";
import { Badge, Card, Row } from "../components/bits";
import { DisturbanceButton } from "../components/Disturbance";
import { PlantMap } from "../components/PlantMap";
import { Photo } from "../components/Photo";
import { ROBOT_STATE, ago, clock, dec, describe, qualityLabel, qualityTone, reasonLabel, show } from "../format";
import { type Entry, payloadOf, stamp, useLive, useNow } from "../live";
import { type Device, type Plant, usePlant } from "../plant";
import { T } from "../topics";

export function RobotPage() {
  const plant = usePlant();
  const live = useLive();
  const [selected, setSelected] = useState<string | null>(null);
  const events = withoutRepeats(live.events.slice(-120))
    .reverse()
    .map((e) => ({ e, d: describe(e) }))
    .filter((x) => x.d)
    .slice(0, 12);
  const device = plant?.equipos.find((e) => e.id === selected);

  return (
    <div className="robot-page">
      <section className="map-panel">
        <header className="panel-head">
          <h1>{plant?.nombre ?? "Planta"}</h1>
        </header>
        {plant ? (
          <PlantMap plant={plant} selected={selected} onSelect={setSelected} />
        ) : (
          <p className="muted pad">Esperando el mapa del robot…</p>
        )}
        <Legend />
      </section>

      <aside className="side">
        <RobotCard />
        {device && plant ? <DeviceCard device={device} plant={plant} onClose={() => setSelected(null)} /> : <Overview />}
      </aside>

      <Card className="log-card" title="Eventos" aside={<span className="muted">{live.rate} msg/s</span>}>
        <ol className="log">
          {events.map(({ e, d }) => (
            <li key={`${e.topic}${e.t}`} className={d!.tone}>
              <time>{clock(e.t)}</time>
              {d!.text}
            </li>
          ))}
          {events.length === 0 && <li className="muted">Sin eventos</li>}
        </ol>
      </Card>
    </div>
  );
}

function Legend() {
  return (
    <ul className="legend">
      <li>
        <span className="swatch walk" /> Pasillo del robot
      </li>
      <li>
        <span className="swatch water" /> Agua de proceso
      </li>
      <li>
        <span className="swatch n2" /> Nitrógeno
      </li>
      <li>
        <span className="swatch live" /> Dato en vivo
      </li>
      <li>
        <span className="swatch warn" /> Aviso
      </li>
      <li>
        <span className="swatch bad" /> Alarma
      </li>
    </ul>
  );
}

function RobotCard() {
  const live = useLive();
  const now = useNow();
  const pose = payloadOf(live.get(T.pose));
  const mission = live.get(T.mission);
  const battery = typeof pose.bateria === "number" ? pose.bateria : null;
  const busy = pose.value === "en-mision" || pose.value === "actuando";
  return (
    <Card title="robot-01" aside={<Badge tone={busy ? "warn" : "ok"}>{ROBOT_STATE[show(pose.value)] ?? show(pose.value)}</Badge>}>
      <div className="battery" aria-label={`Batería ${dec(battery, 0)} %`}>
        <div className={`fill ${battery !== null && battery < 30 ? "low" : ""}`} style={{ width: `${battery ?? 0}%` }} />
        <span>Batería {dec(battery, 0)} %</span>
      </div>
      <Row label="Siguiente parada">{show(pose.destino)}</Row>
      <Row label="Velocidad">{dec(pose.velocidad, 1)} m/s</Row>
      <Row label="Posición">
        {dec(pose.x, 1)} · {dec(pose.y, 1)} m
      </Row>
      <Row label="Última misión">{mission ? `${show(payloadOf(mission).value)}, ${ago(stamp(mission), now)}` : "ninguna"}</Row>
    </Card>
  );
}

function Overview() {
  const live = useLive();
  const rules = [...live.topics.values()].filter((e) => e.topic.startsWith(T.rules));
  const active = rules.filter((r) => payloadOf(r).value === "activa");
  return (
    <Card title="Línea 104" aside={<Badge tone={active.length ? "bad" : "ok"}>{active.length ? `${active.length} alarma${active.length > 1 ? "s" : ""}` : "Sin alarmas"}</Badge>}>
      <Row label="Presión, visión PI-104">
        {dec(payloadOf(live.get(T.pi104)).value, 2)} bar
      </Row>
      <Row label="Presión, PLC PT-104">{dec(payloadOf(live.get(T.pt104)).value, 2)} bar</Row>
      <Row label="Caudal FT-104">{dec(payloadOf(live.get(T.ft104)).value, 1)} m³/h</Row>
      <Row label="Nivel T-101">{dec(payloadOf(live.get(T.lt101)).value, 0)} %</Row>
      <Row label="XV-104">{show(payloadOf(live.get(T.xv104)).value)}</Row>
      <div className="rules-mini">
        {rules.map((r) => (
          <Row key={r.topic} label={r.topic.slice(T.rules.length)}>
            <Badge tone={payloadOf(r).value === "activa" ? "bad" : "ok"}>{show(payloadOf(r).value)}</Badge>
          </Row>
        ))}
      </div>
      <DisturbanceButton />
    </Card>
  );
}

function DeviceCard({ device: d, onClose }: { device: Device; plant: Plant; onClose: () => void }) {
  const live = useLive();
  const now = useNow();
  const entry = d.senal ? live.get(d.senal) : undefined;
  const inspection = d.senal ? live.get(`${d.senal}/inspeccion`) : undefined;
  const p = payloadOf(entry);
  const i = payloadOf(inspection);
  const visual = d.tipo === "manometro" || d.tipo === "extintor";
  return (
    <Card
      title={d.id}
      aside={
        <button className="btn small" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <p className="device-name">{d.nombre}</p>
      {visual ? (
        <>
          <Photo entry={inspection} />
          <Row label="Lectura">
            {i.value === null || i.value === undefined ? "sin lectura" : `${show(i.value)}${i.unit ? ` ${i.unit}` : ""}`}
          </Row>
          <Row label="Calidad">
            <Badge tone={qualityTone(i.quality)}>{qualityLabel(i.quality)}</Badge> {reasonLabel(i.status_reason)}
          </Row>
          <Row label="Inspección">{ago(stamp(inspection), now)}</Row>
        </>
      ) : d.senal ? (
        <>
          <Row label="Valor">
            {show(p.value)} {typeof p.unit === "string" ? p.unit : ""}
          </Row>
          <Row label="Actualizado">{ago(stamp(entry), now)}</Row>
          {d.id === "P-104" && (
            <>
              <Row label="Corriente">{dec(payloadOf(live.get(T.p104Current)).value, 1)} A</Row>
              <Row label="Arranques">{show(payloadOf(live.get(T.p104Starts)).value)}</Row>
            </>
          )}
        </>
      ) : (
        <p className="muted">Sin señal en el UNS</p>
      )}
      {d.senal && <p className="topic">{d.senal}</p>}
    </Card>
  );
}

/** A state published again with the same value (a heartbeat, the same valve check) is not news.
 * Photos and inspections are: each one is a new look at the plant. */
function withoutRepeats(events: Entry[]): Entry[] {
  const last = new Map<string, string>();
  return events.filter((e) => {
    if (e.topic === T.photo || e.topic.endsWith("/inspeccion")) return true;
    const v = JSON.stringify(payloadOf(e).value);
    const same = last.get(e.topic) === v;
    last.set(e.topic, v);
    return !same;
  });
}
