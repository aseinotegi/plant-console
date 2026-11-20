// Vision, opened up: from the robot's photo to the value in the UNS. The exact prompt
// and JSON schema of each point (published by the inspector itself), the model's raw
// answer, the checks that decide the quality, and how well it reads against the true
// value of each photo.

import { useState } from "react";
import { Badge, Card } from "../components/bits";
import { Photo } from "../components/Photo";
import { clock, dec, qualityLabel, qualityTone, reasonLabel, show } from "../format";
import { type Entry, payloadOf, useLive } from "../live";
import { T } from "../topics";

interface PoiConfig {
  profile: string;
  kind: "numeric" | "state";
  tag: string;
  uns_topic: string;
  expect: { unit: string; min: number; max: number; max_step?: number | null } | null;
  min_confidence: number;
  prompt: string;
  schema: unknown;
}

interface Verdict {
  truth: string | null;
  hit: boolean | null;
  error: number | null;
}

type Live = ReturnType<typeof useLive>;

function fileOf(live: Live, entry: Entry): string | null {
  const p = payloadOf(entry);
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  return url?.split("/").pop() ?? null;
}

/** The inspection against the true value of its photo. */
function judge(live: Live, entry: Entry, cfg: PoiConfig | undefined): Verdict {
  const file = fileOf(live, entry);
  const truth = file ? live.credits[file]?.valor : undefined;
  if (truth === undefined) return { truth: null, hit: null, error: null };
  const v = payloadOf(entry).value;
  if (truth === "") return { truth: "ilegible", hit: v === null || v === undefined, error: null };
  if (truth === "OK" || truth === "NOK") return { truth, hit: v === truth, error: null };
  const real = Number(truth);
  if (typeof v !== "number") return { truth, hit: false, error: null };
  const span = cfg?.expect ? cfg.expect.max - cfg.expect.min : 10;
  const error = Math.abs(v - real);
  return { truth, hit: error <= Math.max(span * 0.02, 0.05), error };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function VisionPage() {
  const live = useLive();
  const config = payloadOf(live.get(`${T.services}inspector/config`));
  const pois = (config.pois ?? {}) as Record<string, PoiConfig>;
  const ids = Object.keys(pois).length ? Object.keys(pois) : [...new Set(live.inspections.map((e) => String(payloadOf(e).poi)))].sort();
  const [poi, setPoi] = useState<string | null>(null);
  const current = poi ?? ids[0] ?? null;
  const all = live.inspections;
  const verdicts = all.map((e) => ({ e, v: judge(live, e, pois[String(payloadOf(e).poi)]) }));
  const judged = verdicts.filter((x) => x.v.hit !== null);
  const latency = mean(all.map((e) => Number((payloadOf(e).trace as Record<string, unknown> | undefined)?.latency_ms)).filter(Number.isFinite));
  const confidence = mean(all.map((e) => Number(payloadOf(e).confidence)).filter(Number.isFinite));
  const model = String(config.model ?? payloadOf(live.get(`${T.services}inspector`)).model ?? "—");

  return (
    <div className="vision-page">
      <header className="panel-head row-between">
        <h1>Visión</h1>
        {config.value !== undefined && <span className="muted small">prompt {String(config.value)}</span>}
      </header>

      <div className="tiles">
        <Tile label="Modelo" value={model} sub={model === "replay" ? "respuestas grabadas" : String(config.provider ?? "")} />
        <Tile label="Inspecciones" value={String(all.length)} />
        <Tile label="Fiables" value={all.length ? `${Math.round((all.filter((e) => payloadOf(e).quality === "good").length / all.length) * 100)} %` : "—"} />
        <Tile label="Acierto vs valor real" value={judged.length ? `${Math.round((judged.filter((x) => x.v.hit).length / judged.length) * 100)} %` : "—"} sub={judged.length ? `${judged.length} fotos` : ""} />
        <Tile label="Confianza media" value={confidence !== null ? `${Math.round(confidence * 100)} %` : "—"} />
        <Tile label="Latencia media" value={latency !== null ? `${dec(latency, 0)} ms` : "—"} />
      </div>

      <nav className="poi-tabs" aria-label="Punto de inspección">
        {ids.map((id) => {
          const last = [...all].reverse().find((e) => payloadOf(e).poi === id);
          return (
            <button key={id} className={id === current ? "active" : ""} onClick={() => setPoi(id)}>
              <span className={`dot-state ${last ? qualityTone(payloadOf(last).quality) : "idle"}`} />
              {id}
              <span className="kind">{pois[id]?.profile ?? ""}</span>
            </button>
          );
        })}
      </nav>

      {current && <Pipeline id={current} cfg={pois[current]} config={config} />}

      <Card title="Analítica por punto">
        <table className="tags">
          <thead>
            <tr>
              <th>Punto</th>
              <th>Perfil</th>
              <th className="num">Inspecciones</th>
              <th className="num">Fiables</th>
              <th className="num">Dudosas</th>
              <th className="num">Acierto</th>
              <th className="num">Error medio</th>
              <th className="num">Confianza</th>
              <th className="num">Latencia</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const mine = verdicts.filter((x) => payloadOf(x.e).poi === id);
              const ok = mine.filter((x) => x.v.hit !== null);
              const errs = mine.map((x) => x.v.error).filter((x): x is number => x !== null);
              const conf = mean(mine.map((x) => Number(payloadOf(x.e).confidence)).filter(Number.isFinite));
              const lat = mean(mine.map((x) => Number((payloadOf(x.e).trace as Record<string, unknown> | undefined)?.latency_ms)).filter(Number.isFinite));
              const unit = pois[id]?.expect?.unit ?? "";
              return (
                <tr key={id}>
                  <td className="strong">{id}</td>
                  <td>{pois[id]?.profile ?? "—"}</td>
                  <td className="num">{mine.length}</td>
                  <td className="num">{mine.filter((x) => payloadOf(x.e).quality === "good").length}</td>
                  <td className="num">{mine.filter((x) => payloadOf(x.e).quality !== "good").length}</td>
                  <td className="num">{ok.length ? `${Math.round((ok.filter((x) => x.v.hit).length / ok.length) * 100)} %` : "—"}</td>
                  <td className="num">{errs.length ? `${dec(mean(errs), 2)} ${unit}` : "—"}</td>
                  <td className="num">{conf !== null ? `${Math.round(conf * 100)} %` : "—"}</td>
                  <td className="num">{lat !== null ? `${dec(lat, 0)} ms` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Últimas lecturas">
        <div className="strip">
          {verdicts
            .slice(-18)
            .reverse()
            .map(({ e, v }) => {
              const p = payloadOf(e);
              return (
                <figure key={`${e.topic}${e.t}`} className={v.hit === false ? "bad" : qualityTone(p.quality)}>
                  <Photo entry={e} small />
                  <figcaption>
                    <b>{show(p.poi)}</b> {p.value === null ? "—" : show(p.value)}
                    {v.truth !== null && (
                      <span className={v.hit ? "hit" : "miss"}>
                        {" "}
                        {v.hit ? "✓" : "✗"} real {v.truth}
                      </span>
                    )}
                    <br />
                    <span className="muted">
                      {clock(e.t)} · {qualityLabel(p.quality)}
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

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">
        {label}
        {sub ? ` · ${sub}` : ""}
      </span>
    </div>
  );
}

function Pipeline({ id, cfg, config }: { id: string; cfg: PoiConfig | undefined; config: Record<string, unknown> }) {
  const live = useLive();
  const entry = [...live.inspections].reverse().find((e) => payloadOf(e).poi === id) ?? [...live.topics.values()].find((e) => e.topic.endsWith("/inspeccion") && payloadOf(e).poi === id);
  const p = payloadOf(entry);
  const trace = (p.trace ?? {}) as Record<string, unknown>;
  const checks = Array.isArray(p.checks) ? (p.checks as unknown[]) : [];
  const published = cfg ? live.get(cfg.uns_topic) : undefined;
  const verdict = entry ? judge(live, entry, cfg) : null;
  const raw = typeof trace.raw === "string" ? pretty(trace.raw) : null;
  const file = entry ? fileOf(live, entry) : null;
  const credit = file ? live.credits[file] : undefined;

  const steps = [
    { n: 1, title: "Foto", main: show(p.image), sub: credit ? (credit.licencia.startsWith("CC") ? "real" : "generada") : "" },
    { n: 2, title: "Prompt", main: cfg?.profile ?? "—", sub: cfg?.kind === "numeric" ? `${cfg.expect?.min}–${cfg.expect?.max} ${cfg.expect?.unit}` : cfg ? "estado" : "" },
    { n: 3, title: "Modelo", main: show(trace.model ?? config.model), sub: typeof trace.latency_ms === "number" ? `${trace.latency_ms} ms` : "" },
    { n: 4, title: "Respuesta JSON", main: p.value === null || p.value === undefined ? "null" : show(p.value), sub: reasonLabel(p.status_reason) },
    { n: 5, title: "Comprobaciones", main: checks.length ? `${checks.length} fallo${checks.length > 1 ? "s" : ""}` : "todas bien", sub: cfg ? `confianza ≥ ${Math.round(cfg.min_confidence * 100)} %` : "" },
    { n: 6, title: "UNS", main: qualityLabel(p.quality), sub: cfg?.uns_topic.split("/").slice(1).join("/") ?? "" },
  ];

  return (
    <section className="pipeline-wrap">
      <ol className="pipeline">
        {steps.map((s) => (
          <li key={s.n} className={s.n === 6 ? qualityTone(p.quality) : s.n === 5 && checks.length ? "warn" : ""}>
            <span className="step-n">{s.n}</span>
            <span className="step-title">{s.title}</span>
            <span className="step-main">{s.main}</span>
            <span className="step-sub">{s.sub}</span>
          </li>
        ))}
      </ol>

      <div className="vision-grid">
        <Card title="Foto" aside={<Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}>
          <Photo entry={entry} />
          {verdict?.truth !== null && verdict && (
            <p className={`truth ${verdict.hit ? "hit" : "miss"}`}>
              Valor real {verdict.truth} {cfg?.expect && verdict.truth !== "ilegible" ? cfg.expect.unit : ""} · leído {p.value === null ? "null" : show(p.value)} · {verdict.hit ? "acierto" : "fallo"}
            </p>
          )}
        </Card>

        <Card title={`Prompt · ${cfg?.profile ?? ""}`}>
          <pre className="code">{cfg?.prompt ?? "El inspector todavía no ha publicado su configuración."}</pre>
          {cfg && (
            <details>
              <summary>Esquema JSON</summary>
              <pre className="code">{JSON.stringify(cfg.schema, null, 2)}</pre>
            </details>
          )}
        </Card>

        <Card title="Respuesta del modelo">
          <pre className="code">{raw ?? "—"}</pre>
          <div className="checks-list">
            {checks.length ? (
              checks.map((c) => (
                <p key={String(c)} className="result warn">
                  {show(c)}
                </p>
              ))
            ) : (
              <p className="result ok">Comprobaciones superadas</p>
            )}
          </div>
          <details>
            <summary>Mensaje publicado en {cfg?.uns_topic ?? "el UNS"}</summary>
            <pre className="code">{published ? JSON.stringify(published.payload, null, 2) : "No se publica: una lectura rechazada no pisa la anterior."}</pre>
          </details>
          <details>
            <summary>Inspección completa</summary>
            <pre className="code">{entry ? JSON.stringify(entry.payload, null, 2) : "—"}</pre>
          </details>
        </Card>
      </div>
    </section>
  );
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
