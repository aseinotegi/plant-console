import { Badge, Card, Row } from "../components/bits";
import { ago, clock, qualityLabel, qualityTone, show } from "../format";
import { type Entry, payloadOf, stamp, useLive, useNow } from "../live";

export function VisionPage() {
  const live = useLive();
  const now = useNow();
  const current = [...live.topics.values()].filter((e) => e.topic.endsWith("/inspeccion"));
  const recent = live.events.filter((e) => e.topic.endsWith("/inspeccion")).slice(-18).reverse();
  const model = [...live.topics.values()].find((e) => e.topic.endsWith("/servicios/inspector"));

  return (
    <div className="vision-page">
      <p className="muted intro">
        El robot manda cada foto al UNS con su punto de interés. poi-vision-inspector la lee con un modelo multimodal según el perfil de ese punto y publica la lectura con su calidad. Solo las lecturas de calidad buena cuentan para las reglas.
        {model && <> Modelo: <span className="mono">{show(payloadOf(model).model).replace(/\/$/, "")}</span>.</>}
      </p>
      <div className="poi-grid">
        {current.map((e) => (
          <Inspection key={e.topic} entry={e} now={now} />
        ))}
        {current.length === 0 && <p className="muted">Todavía no hay inspecciones.</p>}
      </div>
      <Card title="Últimas fotos">
        <div className="strip">
          {recent.map((e) => {
            const p = payloadOf(e);
            const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
            return (
              <figure key={`${e.topic}${e.t}`} className={qualityTone(p.quality)}>
                {url ? <img src={url} alt={show(p.poi)} loading="lazy" /> : <div className="noimg" />}
                <figcaption>
                  <b>{show(p.poi)}</b> {p.value === null ? "—" : show(p.value)} · {qualityLabel(p.quality)}
                  <br />
                  <span className="muted">{clock(e.t)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Inspection({ entry, now }: { entry: Entry; now: number }) {
  const live = useLive();
  const p = payloadOf(entry);
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  const trace = (p.trace ?? {}) as Record<string, unknown>;
  const checks = Array.isArray(p.checks) ? (p.checks as unknown[]) : [];
  return (
    <Card title={show(p.poi)} aside={<Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}>
      {url ? <img className="photo" src={url} alt={`Foto de ${show(p.poi)}`} /> : <div className="photo noimg">foto no disponible</div>}
      <div className="reading">
        <span className="big mono">{p.value === null || p.value === undefined ? "—" : show(p.value)}</span>
        {typeof p.unit === "string" && <span className="unit">{p.unit}</span>}
      </div>
      <Row label="Motivo">{show(p.status_reason)}</Row>
      <Row label="Confianza">{typeof p.confidence === "number" ? `${Math.round(p.confidence * 100)} %` : "—"}</Row>
      <Row label="Lo que ve">{show(p.evidence)}</Row>
      <Row label="Comprobaciones">{checks.length ? checks.map(show).join(" · ") : "todas bien"}</Row>
      <Row label="Modelo">
        {show(trace.provider)}
        {trace.model && trace.model !== trace.provider ? ` / ${show(trace.model)}` : ""}
        {typeof trace.latency_ms === "number" ? ` · ${trace.latency_ms} ms` : ""}
      </Row>
      <Row label="Foto">
        {show(p.image)} · {ago(stamp(entry), now)}
      </Row>
    </Card>
  );
}
