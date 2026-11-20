import { Badge, Card, Row } from "../components/bits";
import { Photo } from "../components/Photo";
import { ago, clock, qualityLabel, qualityTone, reasonLabel, show } from "../format";
import { type Entry, payloadOf, stamp, useLive, useNow } from "../live";

export function VisionPage() {
  const live = useLive();
  const now = useNow();
  const current = [...live.topics.values()].filter((e) => e.topic.endsWith("/inspeccion")).sort((a, b) => String(payloadOf(a).poi).localeCompare(String(payloadOf(b).poi)));
  const recent = live.events.filter((e) => e.topic.endsWith("/inspeccion")).slice(-16).reverse();
  const model = [...live.topics.values()].find((e) => e.topic.endsWith("/servicios/inspector"));
  const modelName = String(payloadOf(model).model ?? "").replace(/\/$/, "");

  return (
    <div className="vision-page">
      <header className="panel-head">
        <h1>Visión</h1>
        <p className="muted">
          El robot manda cada foto al UNS con su punto de inspección. poi-vision-inspector la lee con un modelo multimodal según lo que hay en ese punto (un manómetro, un termomanómetro, un extintor) y publica la lectura con su calidad. Si no la puede leer, lo dice: una lectura dudosa nunca cuenta para una regla.
          {modelName && (
            <>
              {" "}
              Modelo en uso: <b>{modelName === "replay" ? "respuestas grabadas (replay), sin modelo" : modelName}</b>.
            </>
          )}
        </p>
      </header>
      <div className="poi-grid">
        {current.map((e) => (
          <Inspection key={e.topic} entry={e} now={now} />
        ))}
        {current.length === 0 && <p className="muted">Todavía no hay inspecciones. El robot está haciendo la primera ronda.</p>}
      </div>
      <Card title="Últimas fotos de la ronda">
        <div className="strip">
          {recent.map((e) => {
            const p = payloadOf(e);
            return (
              <figure key={`${e.topic}${e.t}`} className={qualityTone(p.quality)}>
                <Photo entry={e} small />
                <figcaption>
                  <b>{show(p.poi)}</b> {p.value === null ? "sin lectura" : show(p.value)}
                  <br />
                  <span className="muted">
                    {clock(e.t)}, {qualityLabel(p.quality)}
                  </span>
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
  const p = payloadOf(entry);
  const trace = (p.trace ?? {}) as Record<string, unknown>;
  const checks = Array.isArray(p.checks) ? (p.checks as unknown[]) : [];
  return (
    <Card title={show(p.poi)} aside={<Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}>
      <Photo entry={entry} />
      <div className="reading">
        <span className="big">{p.value === null || p.value === undefined ? "—" : show(p.value)}</span>
        {typeof p.unit === "string" && <span className="unit">{p.unit}</span>}
        <span className="muted">{reasonLabel(p.status_reason)}</span>
      </div>
      <Row label="Confianza">{typeof p.confidence === "number" ? `${Math.round(p.confidence * 100)} %` : "—"}</Row>
      <Row label="Lo que ve">{show(p.evidence)}</Row>
      <Row label="Comprobaciones">{checks.length ? checks.map(show).join("; ") : "todas bien"}</Row>
      <Row label="Modelo">
        {show(trace.provider)}
        {trace.model && trace.model !== trace.provider ? ` / ${show(trace.model)}` : ""}
        {typeof trace.latency_ms === "number" ? `, ${trace.latency_ms} ms` : ""}
      </Row>
      <Row label="Foto">
        {show(p.image)}, {ago(stamp(entry), now)}
      </Row>
    </Card>
  );
}
