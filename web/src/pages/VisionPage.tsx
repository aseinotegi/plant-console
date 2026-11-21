// A catalog the visitor can inspect directly, followed by the exact execution and
// session analytics. Repeated robot inspections are not a reproducible model evaluation.

import { type ChangeEvent, useState } from "react";
import { Badge, Card } from "../components/bits";
import { InspectionImage } from "../components/InspectionImage";
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

interface TrialRun {
  request: string;
  file: string;
  state: string;
  entry?: Entry;
  error?: string;
}

interface UploadCase {
  name: string;
  poi: string;
  mime: string;
  dataUrl: string;
  imageB64: string;
}

type Live = ReturnType<typeof useLive>;
type Origin = "all" | "real" | "generated";
const TRIAL_TOPIC = "planta1/ensayos/vision";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function fileOf(live: Live, entry: Entry): string | null {
  const p = payloadOf(entry);
  if (typeof p.image_file === "string" && live.credits[p.image_file]) return p.image_file;
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  return url?.split("/").pop() ?? null;
}

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
const isReal = (file: string, live: Live) => live.credits[file]?.licencia.startsWith("CC") ?? false;

function dateTime(value: unknown): string {
  if (typeof value !== "string") return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("es-ES") : value;
}

function downloadJson(entry: Entry, file: string) {
  const p = payloadOf(entry);
  const blob = new Blob([JSON.stringify({ ...p, image_file: file }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inspeccion-${String(p.inspection_id ?? p.image ?? file).replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function sendTrial(body: Record<string, unknown>): Promise<Entry> {
  const response = await fetch("/api/vision/ensayos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(String(result.detail ?? `HTTP ${response.status}`));
  if (!result.result || typeof result.result !== "object") throw new Error("Respuesta de ensayo incompleta");
  return { topic: `${TRIAL_TOPIC}/resultado`, payload: result.result, retained: false, t: Date.now() / 1000 };
}

function newRequest(): string {
  return crypto.randomUUID();
}

export function VisionPage() {
  const live = useLive();
  const config = payloadOf(live.get(`${T.services}inspector/config`));
  const pois = (config.pois ?? {}) as Record<string, PoiConfig>;
  const all = live.inspections;
  const ids = [
    ...new Set([...Object.keys(pois), ...Object.values(live.credits).map((c) => c.poi), ...all.map((e) => String(payloadOf(e).poi))]),
  ].sort();
  const [poi, setPoi] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>("all");
  const [trial, setTrial] = useState<TrialRun | null>(null);
  const [upload, setUpload] = useState<UploadCase | null>(null);
  const [uploadTrial, setUploadTrial] = useState<TrialRun | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const current = poi ?? (selectedFile ? live.credits[selectedFile]?.poi : null) ?? ids[0] ?? null;
  const catalogFiles = Object.keys(live.credits)
    .filter((file) => live.credits[file].poi === current)
    .filter((file) => origin === "all" || (origin === "real") === isReal(file, live))
    .sort((a, b) => a.localeCompare(b));
  const file = selectedFile && catalogFiles.includes(selectedFile) ? selectedFile : catalogFiles[0] ?? null;
  const credit = file ? live.credits[file] : undefined;
  const cfg = current ? pois[current] : undefined;
  const retained = [...live.topics.values()].filter((e) => e.topic.endsWith("/inspeccion"));
  const robotEntry = file ? [...all, ...retained].reverse().find((e) => fileOf(live, e) === file) : undefined;
  const selectedTrial = trial?.file === file ? trial : null;
  const entry = selectedTrial?.entry ?? (selectedTrial ? undefined : robotEntry);
  const p = payloadOf(entry);
  const status = payloadOf(live.get(`${TRIAL_TOPIC}/estado`));

  const verdicts = all.map((e) => ({ e, v: judge(live, e, pois[String(payloadOf(e).poi)]) }));
  const judged = verdicts.filter((x) => x.v.hit !== null);
  const latency = mean(all.map((e) => Number((payloadOf(e).trace as Record<string, unknown> | undefined)?.latency_ms)).filter(Number.isFinite));
  const confidence = mean(all.map((e) => Number(payloadOf(e).confidence)).filter(Number.isFinite));
  const model = String(config.model ?? payloadOf(live.get(`${T.services}inspector`)).model ?? "—");
  const wrongTrusted = verdicts.filter((x) => payloadOf(x.e).quality === "good" && x.v.hit === false).length;

  const choosePoi = (id: string) => {
    setPoi(id);
    setSelectedFile(null);
  };
  const chooseEntry = (candidate: Entry) => {
    const selected = fileOf(live, candidate);
    if (!selected) return;
    setPoi(live.credits[selected]?.poi ?? String(payloadOf(candidate).poi));
    setOrigin("all");
    setSelectedFile(selected);
    document.querySelector(".vision-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const analyzeCatalog = async () => {
    if (!file || !current) return;
    const request = newRequest();
    setTrial({ request, file, state: "en-cola" });
    try {
      const result = await sendTrial({ poi: current, file, request });
      setTrial({ request, file, state: String(payloadOf(result).state ?? "completada"), entry: result });
    } catch (error) {
      setTrial({ request, file, state: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    setUploadError(null);
    setUploadTrial(null);
    if (!image) {
      setUpload(null);
      return;
    }
    if (!["image/jpeg", "image/png"].includes(image.type)) {
      setUpload(null);
      setUploadError("Solo se admiten imágenes JPEG o PNG.");
      return;
    }
    if (image.size > MAX_IMAGE_BYTES) {
      setUpload(null);
      setUploadError("La imagen supera el límite de 8 MiB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setUpload({ name: image.name, poi: current ?? ids[0] ?? "", mime: image.type, dataUrl: reader.result, imageB64: reader.result.split(",", 2)[1] ?? "" });
    };
    reader.onerror = () => setUploadError("No se pudo leer la imagen seleccionada.");
    reader.readAsDataURL(image);
  };

  const analyzeUpload = async () => {
    if (!upload?.poi) return;
    const request = newRequest();
    setUploadTrial({ request, file: upload.name, state: "en-cola" });
    try {
      const result = await sendTrial({ poi: upload.poi, image_b64: upload.imageB64, mime: upload.mime, request });
      setUploadTrial({ request, file: upload.name, state: String(payloadOf(result).state ?? "completada"), entry: result });
    } catch (error) {
      setUploadTrial({ request, file: upload.name, state: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="vision-page">
      <header className="panel-head row-between">
        <h1>Visión</h1>
        {config.value !== undefined && <span className="muted small">prompt {String(config.value)}</span>}
      </header>

      <div className="tiles">
        <Tile label="Modelo" value={model} sub={model === "replay" ? "respuestas grabadas" : String(config.provider ?? "")} />
        <Tile label="Inspecciones" value={String(all.length)} sub="eventos de esta sesión" />
        <Tile label="Imágenes únicas" value={String(new Set(all.map((e) => fileOf(live, e)).filter(Boolean)).size)} />
        <Tile label="Fiables" value={all.length ? `${Math.round((all.filter((e) => payloadOf(e).quality === "good").length / all.length) * 100)} %` : "—"} />
        <Tile label="Acierto de sesión" value={judged.length ? `${Math.round((judged.filter((x) => x.v.hit).length / judged.length) * 100)} %` : "—"} sub="no es una evaluación guardada" />
        <Tile label="Incorrectas aceptadas" value={String(wrongTrusted)} sub="good + fallo frente a referencia" />
        <Tile label="Confianza media" value={confidence !== null ? `${Math.round(confidence * 100)} %` : "—"} sub="declarada por el modelo" />
        <Tile label="Latencia media" value={latency !== null ? `${dec(latency, 0)} ms` : "—"} />
      </div>

      <nav className="poi-tabs" aria-label="Punto de inspección">
        {ids.map((id) => {
          const last = [...all].reverse().find((e) => payloadOf(e).poi === id);
          return (
            <button key={id} className={id === current ? "active" : ""} onClick={() => choosePoi(id)}>
              <span className={`dot-state ${last ? qualityTone(payloadOf(last).quality) : "idle"}`} />
              {id}
              <span className="kind">{pois[id]?.profile ?? ""}</span>
            </button>
          );
        })}
      </nav>

      <section className="vision-explorer">
        <Card title={`Catálogo · ${current ?? "—"}`} aside={<span className="muted small">{catalogFiles.length} casos</span>} className="catalog-card">
          <div className="catalog-origin" aria-label="Filtrar por procedencia">
            {(["all", "real", "generated"] as Origin[]).map((value) => (
              <button key={value} className={`btn small ${origin === value ? "primary" : ""}`} onClick={() => setOrigin(value)}>
                {value === "all" ? "Todas" : value === "real" ? "Reales" : "Generadas"}
              </button>
            ))}
          </div>
          <div className="catalog-cases">
            {catalogFiles.map((candidate) => {
              const item = live.credits[candidate];
              const analyzed = all.some((e) => fileOf(live, e) === candidate) || trial?.file === candidate;
              return (
                <button key={candidate} className={`catalog-case ${candidate === file ? "selected" : ""}`} onClick={() => setSelectedFile(candidate)} aria-pressed={candidate === file}>
                  <img src={`/api/fotos/${candidate}`} alt="" loading="lazy" />
                  <span className="catalog-case-body">
                    <b>{item.condicion}</b>
                    <span>Referencia: {item.valor || "ilegible"}{item.valor && cfg?.expect ? ` ${cfg.expect.unit}` : ""}</span>
                    <span className="muted">{isReal(candidate, live) ? "Fotografía real" : "Generada"}{analyzed ? " · con ejecución" : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {file && credit ? (
          <div className="selected-case">
            <Card title={file} aside={entry ? <Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge> : <Badge tone="idle">Sin analizar</Badge>}>
              <div className="case-metadata">
                <span><b>{credit.poi}</b> · {pois[credit.poi]?.profile ?? "perfil no publicado"}</span>
                <span>{credit.condicion} · {isReal(file, live) ? "fotografía real" : "imagen generada"}</span>
                <span>Valor de referencia: <b>{credit.valor || "ilegible"}{credit.valor && cfg?.expect ? ` ${cfg.expect.unit}` : ""}</b></span>
              </div>
              <InspectionImage entry={entry} file={file} url={`/api/fotos/${file}`} />
              <p className="muted small photo-credit">
                {isReal(file, live) ? <><a href={credit.fuente} target="_blank" rel="noreferrer">{credit.autor}</a> · {credit.licencia}</> : `${credit.autor} · ${credit.licencia}`}
              </p>
              <div className="trial-actions">
                <button className="btn primary" onClick={analyzeCatalog} disabled={isRunning(selectedTrial)}>Analizar esta imagen</button>
                <Badge tone="idle">Ensayo: no modifica la planta</Badge>
              </div>
              <TrialStatus run={selectedTrial} status={status} />
            </Card>

            <Card title="Resultado y validación" className="case-result">
              {!entry ? (
                <div className="empty-result">
                  <h3>{selectedTrial ? "Ensayo en curso" : "Sin ejecución en esta sesión"}</h3>
                  <p className="muted">{selectedTrial ? "El resultado quedará fijado aquí cuando termine; este ensayo no publica valores en el UNS de la planta." : "La referencia describe el dataset; no es una respuesta del modelo. Puedes ejecutar ahora un ensayo aislado o examinar una ejecución del robot."}</p>
                </div>
              ) : <ResultDetails live={live} cfg={cfg} entry={entry} file={file} imageUrl={`/api/fotos/${file}`} />}
            </Card>

            {entry && <ExecutionDetails live={live} cfg={cfg} config={config} entry={entry} />}
          </div>
        ) : <Card title="Sin casos">No hay imágenes para este filtro.</Card>}
      </section>

      {live.uploads && <Card title="Probar una imagen nueva" className="upload-card">
        <p className="muted">
          Sube la foto de un manómetro o de un extintor. La lee {String(config.trial_model ?? model)}; no cambia nada de la planta.
          {live.trialsPerHour > 0 && ` Hasta ${live.trialsPerHour} análisis por hora.`}
        </p>
        {String(config.trial_provider ?? config.provider) === "gemini" && (
          <p className="muted small">
            La imagen se envía a Google (Gemini). En el plan gratuito, Google puede usarla para mejorar sus productos: no subas fotos con personas ni datos privados. Aquí no se guarda.
          </p>
        )}
        <div className="upload-controls">
          <input type="file" accept="image/jpeg,image/png" onChange={chooseUpload} />
          <label>Punto de inspección
            <select value={upload?.poi ?? current ?? ""} disabled={!upload} onChange={(e) => upload && setUpload({ ...upload, poi: e.target.value })}>
              {ids.map((id) => <option key={id} value={id}>{id} · {pois[id]?.profile ?? ""}</option>)}
            </select>
          </label>
          <button className="btn primary" disabled={!upload || isRunning(uploadTrial)} onClick={analyzeUpload}>Analizar imagen nueva</button>
        </div>
        {uploadError && <p className="result bad">{uploadError}</p>}
        {upload && (
          <div className="upload-result">
            <div>
              <InspectionImage entry={uploadTrial?.entry} file={upload.name} url={upload.dataUrl} />
              <p className="muted small">{upload.name} · {upload.mime} · POI indicado: {upload.poi}</p>
              <TrialStatus run={uploadTrial} status={status} />
            </div>
            {uploadTrial?.entry && (
              <div>
                <ResultDetails live={live} cfg={pois[upload.poi]} entry={uploadTrial.entry} file={upload.name} imageUrl={upload.dataUrl} />
                <ExecutionDetails live={live} cfg={pois[upload.poi]} config={config} entry={uploadTrial.entry} />
              </div>
            )}
          </div>
        )}
      </Card>}

      <Card title="Analítica por punto · solo sesión actual">
        <table className="tags">
          <thead><tr><th>Punto</th><th>Perfil</th><th className="num">Inspecciones</th><th className="num">Fiables</th><th className="num">Dudosas</th><th className="num">Acierto</th><th className="num">Error medio</th><th className="num">Confianza</th><th className="num">Latencia</th></tr></thead>
          <tbody>
            {ids.map((id) => {
              const mine = verdicts.filter((x) => payloadOf(x.e).poi === id);
              const ok = mine.filter((x) => x.v.hit !== null);
              const errs = mine.map((x) => x.v.error).filter((x): x is number => x !== null);
              const conf = mean(mine.map((x) => Number(payloadOf(x.e).confidence)).filter(Number.isFinite));
              const lat = mean(mine.map((x) => Number((payloadOf(x.e).trace as Record<string, unknown> | undefined)?.latency_ms)).filter(Number.isFinite));
              const unit = pois[id]?.expect?.unit ?? "";
              return <tr key={id}><td className="strong">{id}</td><td>{pois[id]?.profile ?? "—"}</td><td className="num">{mine.length}</td><td className="num">{mine.filter((x) => payloadOf(x.e).quality === "good").length}</td><td className="num">{mine.filter((x) => payloadOf(x.e).quality !== "good").length}</td><td className="num">{ok.length ? `${Math.round((ok.filter((x) => x.v.hit).length / ok.length) * 100)} %` : "—"}</td><td className="num">{errs.length ? `${dec(mean(errs), 2)} ${unit}` : "—"}</td><td className="num">{conf !== null ? `${Math.round(conf * 100)} %` : "—"}</td><td className="num">{lat !== null ? `${dec(lat, 0)} ms` : "—"}</td></tr>;
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Últimas lecturas · selecciona una para examinarla">
        <div className="strip">
          {verdicts.slice(-18).reverse().map(({ e, v }, index) => {
            const item = payloadOf(e);
            return (
              <figure key={String(item.inspection_id ?? `${e.topic}${e.t}${index}`)} className={v.hit === false ? "bad" : qualityTone(item.quality)}>
                <Photo entry={e} small />
                <figcaption>
                  <b>{show(item.poi)}</b> {item.value === null ? "—" : show(item.value)}
                  {v.truth !== null && <span className={v.hit ? "hit" : "miss"}> {v.hit ? "✓" : "✗"} real {v.truth}</span>}
                  <br /><span className="muted">{clock(e.t)} · {qualityLabel(item.quality)}</span><br />
                  <button className="btn small" onClick={() => chooseEntry(e)}>Examinar</button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function isRunning(run: TrialRun | null): boolean {
  return run !== null && !run.entry && !run.error && ["en-cola", "analizando"].includes(run.state);
}

function TrialStatus({ run, status }: { run: TrialRun | null; status: ReturnType<typeof payloadOf> }) {
  if (!run) return null;
  const ownStatus = status.request === run.request ? status : {};
  const final = run.entry ? payloadOf(run.entry) : {};
  const state = String(final.state ?? ownStatus.state ?? ownStatus.value ?? run.state);
  const tone = state === "error" ? "bad" : state === "completada" ? "ok" : "live";
  const message = run.error ?? String(final.error ?? ownStatus.error ?? "");
  return (
    <div className={`trial-status ${tone}`} role="status">
      <Badge tone={tone}>{state}</Badge>
      <span>Ensayo <code>{run.request}</code> · no modifica la planta</span>
      {message && <span className="bad">{message}</span>}
    </div>
  );
}

function ResultDetails({ live, cfg, entry, file, imageUrl }: { live: Live; cfg: PoiConfig | undefined; entry: Entry; file: string; imageUrl: string }) {
  const p = payloadOf(entry);
  const checks = Array.isArray(p.checks) ? p.checks : [];
  const verdict = judge(live, entry, cfg);
  return (
    <>
      <div className="reading">
        <span className="big">{p.value === null || p.value === undefined ? "—" : show(p.value)}</span>
        <span className="unit">{show(p.unit)}</span>
        <Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>
      </div>
      <p><b>{reasonLabel(p.status_reason)}</b> · {show(p.evidence || p.error)}</p>
      {verdict.truth !== null && <p className={`truth ${verdict.hit ? "hit" : "miss"}`}>Referencia {verdict.truth} · {verdict.hit ? "coincide con la respuesta" : "la respuesta no coincide"}</p>}
      {p.quality === "good" && verdict.hit === false && <p className="result bad">Lectura incorrecta aceptada como válida.</p>}
      {checks.length ? checks.map((check) => <p key={String(check)} className="result warn">{show(check)}</p>) : <p className="result ok">Aceptada tras superar esquema, evidencia y comprobaciones del perfil.</p>}
      <div className="case-facts">
        <span>ID <code>{show(p.inspection_id)}</code></span>
        <span>Captura <b>{dateTime(p.captured_at)}</b></span>
        <span>Procesamiento <b>{dateTime(p.processed_at ?? p.ts)}</b></span>
        <span>Espera en cola <b>{typeof p.queue_wait_ms === "number" ? `${dec(p.queue_wait_ms, 0)} ms` : "—"}</b></span>
      </div>
      <div className="actions evidence-actions">
        <span className="muted small">Descargar evidencia:</span>
        <a className="btn small" href={imageUrl} download={file}>Imagen</a>
        <button className="btn small" onClick={() => downloadJson(entry, file)}>JSON</button>
      </div>
    </>
  );
}

function ExecutionDetails({ live, cfg, config, entry }: { live: Live; cfg: PoiConfig | undefined; config: ReturnType<typeof payloadOf>; entry: Entry }) {
  const p = payloadOf(entry);
  const trace = (p.trace ?? {}) as Record<string, unknown>;
  const raw = typeof trace.raw === "string" ? pretty(trace.raw) : null;
  const uns = cfg ? payloadOf(live.get(cfg.uns_topic)) : {};
  const associatedValue = p.mode !== "ensayo" && p.inspection_id !== undefined && uns.inspection_id === p.inspection_id ? uns : null;
  return (
    <Card title="Modelo y ejecución" className="execution-card">
      <div className="execution-facts">
        <span>Modelo <b>{show(trace.model ?? config.model)}</b></span>
        <span>Proveedor <b>{show(trace.provider ?? config.provider)}</b></span>
        <span>Inferencia <b>{typeof trace.latency_ms === "number" ? `${dec(trace.latency_ms, 0)} ms` : "—"}</b></span>
        <span>Temperatura <b>{show(trace.temperature ?? config.temperature)}</b></span>
        <span>Prompt <code>{show(trace.prompt ?? config.value)}</code></span>
        <span>SHA-256 imagen <code className="hash">{show(trace.image_sha256)}</code></span>
      </div>
      <details><summary>Prompt utilizado y esquema JSON</summary><pre className="code">{show(trace.instruction ?? cfg?.prompt)}</pre><pre className="code">{JSON.stringify(trace.schema ?? cfg?.schema ?? {}, null, 2)}</pre></details>
      <details><summary>Respuesta JSON del modelo</summary><pre className="code">{raw ?? "No hay respuesta: la ejecución terminó antes de inferencia."}</pre></details>
      <details><summary>Mensaje de valor asociado en el UNS</summary><pre className="code">{associatedValue ? JSON.stringify(associatedValue, null, 2) : p.mode === "ensayo" ? "Ensayo aislado: no publica ningún valor en el UNS de la planta." : "No hay un valor asociado a este ID: fue descartado, caducó o el UNS ya contiene una inspección posterior."}</pre></details>
      <details><summary>Inspección completa</summary><pre className="code">{JSON.stringify(entry.payload, null, 2)}</pre></details>
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="stat"><span className="stat-value">{value}</span><span className="stat-label">{label}{sub ? ` · ${sub}` : ""}</span></div>;
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
