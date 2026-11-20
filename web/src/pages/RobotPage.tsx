import { Badge, Card, Row } from "../components/bits";
import { DisturbanceButton } from "../components/Disturbance";
import { PlantMap } from "../components/PlantMap";
import { ROBOT_STATE, ago, clock, describe, num, qualityLabel, qualityTone, show } from "../format";
import { type Entry, payloadOf, stamp, useLive, useNow } from "../live";
import { usePlant } from "../plant";
import { T } from "../topics";

export function RobotPage() {
  const plant = usePlant();
  const live = useLive();
  const now = useNow();
  const pose = payloadOf(live.get(T.pose));
  const mission = live.get(T.mission);
  const pi = live.get(T.pi104);
  const pt = live.get(T.pt104);
  const xv = live.get(T.xv104);
  const ext = live.get(T.ext12);
  const rules = [...live.topics.values()].filter((e) => e.topic.startsWith(T.rules));
  const lastInspection = [...live.events].reverse().find((e) => e.topic.endsWith("/inspeccion"));
  const events = withoutRepeats(live.events.slice(-80))
    .reverse()
    .map((e) => ({ e, d: describe(e) }))
    .filter((x) => x.d)
    .slice(0, 14);

  return (
    <div className="robot-page">
      <Card
        className="map-card"
        title={plant?.nombre ?? "Planta"}
        aside={<span className="muted">ruta de robot-01 · paradas 📷 foto ⚙ válvula</span>}
      >
        {plant ? <PlantMap plant={plant} /> : <p className="muted pad">Esperando el mapa del simulador…</p>}
      </Card>

      <div className="side">
        <Card title="robot-01" aside={<Badge tone={pose.value === "en-mision" || pose.value === "actuando" ? "warn" : "ok"}>{ROBOT_STATE[show(pose.value)] ?? show(pose.value)}</Badge>}>
          <Row label="Siguiente parada">{show(pose.destino)}</Row>
          <Row label="Posición">
            {num(pose.x, 1)}, {num(pose.y, 1)} m
          </Row>
          <Row label="Última misión">
            {mission ? `${show(payloadOf(mission).value)} · ${ago(stamp(mission), now)}` : "ninguna"}
          </Row>
        </Card>

        <Card title="Línea 104">
          <Row label="PI-104 · visión">
            {num(payloadOf(pi).value)} bar <Badge tone={qualityTone(payloadOf(pi).quality)}>{qualityLabel(payloadOf(pi).quality)}</Badge>
            <span className="muted"> {ago(stamp(pi), now)}</span>
          </Row>
          <Row label="PT-104 · PLC">
            {num(payloadOf(pt).value)} bar <span className="muted">{ago(stamp(pt), now)}</span>
          </Row>
          <Row label="XV-104">
            <Badge tone={payloadOf(xv).value === "cerrada" ? "warn" : "idle"}>{show(payloadOf(xv).value)}</Badge>
          </Row>
          <Row label="EXT-12">
            <Badge tone={payloadOf(ext).value === "NOK" ? "bad" : payloadOf(ext).value === "OK" ? "ok" : "idle"}>{show(payloadOf(ext).value)}</Badge>
          </Row>
          <div className="rules-mini">
            {rules.map((r) => (
              <Row key={r.topic} label={r.topic.slice(T.rules.length)}>
                <Badge tone={payloadOf(r).value === "activa" ? "bad" : "ok"}>{show(payloadOf(r).value)}</Badge>
              </Row>
            ))}
          </div>
          <DisturbanceButton />
        </Card>

        {lastInspection && <LastPhoto entry={lastInspection} />}
      </div>

      <Card className="log-card" title="Lo que está pasando" aside={<span className="muted">{live.rate} mensajes/s en el UNS</span>}>
        <ol className="log">
          {events.map(({ e, d }) => (
            <li key={`${e.topic}${e.t}`} className={d!.tone}>
              <time>{clock(e.t)}</time>
              {d!.text}
            </li>
          ))}
          {events.length === 0 && <li className="muted">Todavía nada. El robot está empezando la ronda.</li>}
        </ol>
      </Card>
    </div>
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

function LastPhoto({ entry }: { entry: Entry }) {
  const live = useLive();
  const p = payloadOf(entry);
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  return (
    <Card title={`Última foto · ${show(p.poi)}`} aside={<Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}>
      {url ? <img className="photo" src={url} alt={`Foto de ${show(p.poi)}`} /> : <p className="muted">Foto no disponible</p>}
      <p className="caption">
        {p.value === null || p.value === undefined ? "Sin lectura" : `${show(p.value)}${p.unit ? ` ${p.unit}` : ""}`} · {show(p.status_reason)}
      </p>
    </Card>
  );
}
