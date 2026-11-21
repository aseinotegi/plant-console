// Vision: a photo of your own first, then the catalog with each execution, and the
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
  mime: string;
  dataUrl: string;
  imageB64: string;
}

type Kind = "manometro" | "extintor";
const KINDS: [Kind, string][] = [["manometro", "Manómetro"], ["extintor", "Extintor"]];

/** The point of interest a visitor's photo is read as: the widest range of its kind. */
function poiFor(pois: Record<string, PoiConfig>, kind: Kind): string | null {
  const candidates = Object.entries(pois).filter(([, c]) => c.profile === kind);
  candidates.sort(([, a], [, b]) => (b.expect ? b.expect.max - b.expect.min : 0) - (a.expect ? a.expect.max - a.expect.min : 0));
  return candidates[0]?.[0] ?? null;
}

type Live = ReturnType<typeof useLive>;
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
  const [trial, setTrial] = useState<TrialRun | null>(null);
  const [upload, setUpload] = useState<UploadCase | null>(null);
  const [kind, setKind] = useState<Kind>("manometro");
  const [uploadTrial, setUploadTrial] = useState<TrialRun | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Only real photos are shown; generated ones may still feed the robot's round.
  const realFiles = Object.keys(live.credits).filter((file) => isReal(file, live));
  const catalogIds = ids.filter((id) => realFiles.some((file) => live.credits[file].poi === id));
  const current = poi ?? (selectedFile ? live.credits[selectedFile]?.poi : null) ?? catalogIds[0] ?? null;
  const catalogFiles = realFiles.filter((file) => live.credits[file].poi === current).sort((a, b) => a.localeCompare(b));
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
      setUploadError("Solo JPEG o PNG");
      return;
    }
    if (image.size > MAX_IMAGE_BYTES) {
      setUpload(null);
      setUploadError("Máximo 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setUpload({ name: image.name, mime: image.type, dataUrl: reader.result, imageB64: reader.result.split(",", 2)[1] ?? "" });
    };
    reader.onerror = () => setUploadError("No se pudo leer la imagen");
    reader.readAsDataURL(image);
  };

  const uploadPoi = poiFor(pois, kind);
  const analyzeUpload = async () => {
    if (!upload || !uploadPoi) return;
    const request = newRequest();
    setUploadTrial({ request, file: upload.name, state: "en-cola" });
    try {
      const result = await sendTrial({ poi: uploadPoi, image_b64: upload.imageB64, mime: upload.mime, request });
      setUploadTrial({ request, file: upload.name, state: String(payloadOf(result).state ?? "completada"), entry: result });
    } catch (error) {
      setUploadTrial({ request, file: upload.name, state: "error", error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="vision-page">
      <header className="panel-head">
        <h1>Visión</h1>
      </header>

      {live.uploads && (
        <Card title="Prueba con tu foto" className="upload-card">
          <div className="upload-controls">
            <div className="segmented" role="group" aria-label="Qué hay en la foto">
              {KINDS.map(([value, label]) => (
                <button key={value} className={`btn small ${kind === value ? "primary" : ""}`} onClick={() => { setKind(value); setUploadTrial(null); }}>
                  {label}
                </button>
              ))}
            </div>
            <input type="file" accept="image/jpeg,image/png" onChange={chooseUpload} />
            <button className="btn primary" disabled={!upload || !uploadPoi || isRunning(uploadTrial)} onClick={analyzeUpload}>Analizar</button>
          </div>
          <p className="muted small">
            {String(config.trial_provider ?? config.provider) === "gemini" ? "Gemini (Google) puede usar la imagen · aquí no se guarda" : "No se guarda"}
            {live.trialsPerHour > 0 && ` · ${live.trialsPerHour} por hora`}
          </p>
          {uploadError && <p className="result bad">{uploadError}</p>}
          {upload && (
            <div className="upload-result">
              <div>
                <InspectionImage entry={uploadTrial?.entry} file={upload.name} url={upload.dataUrl} />
                <TrialStatus run={uploadTrial} status={status} />
              </div>
              {uploadTrial?.entry && uploadPoi && (
                <div>
                  <ResultDetails live={live} cfg={pois[uploadPoi]} entry={uploadTrial.entry} file={upload.name} imageUrl={upload.dataUrl} />
                  <ExecutionDetails live={live} cfg={pois[uploadPoi]} config={config} entry={uploadTrial.entry} />
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="tiles">
        <Tile label="Modelo" value={model} />
        <Tile label="Inspecciones" value={String(all.length)} />
        <Tile label="Imágenes únicas" value={String(new Set(all.map((e) => fileOf(live, e)).filter(Boolean)).size)} />
        <Tile label="Fiables" value={all.length ? `${Math.round((all.filter((e) => payloadOf(e).quality === "good").length / all.length) * 100)} %` : "—"} />
        <Tile label="Acierto de sesión" value={judged.length ? `${Math.round((judged.filter((x) => x.v.hit).length / judged.length) * 100)} %` : "—"} />
        <Tile label="Incorrectas aceptadas" value={String(wrongTrusted)} />
        <Tile label="Confianza media" value={confidence !== null ? `${Math.round(confidence * 100)} %` : "—"} />
        <Tile label="Latencia media" value={latency !== null ? `${dec(latency, 0)} ms` : "—"} />
      </div>

      <nav className="poi-tabs" aria-label="Punto de inspección">
        {catalogIds.map((id) => {
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
          <div className="catalog-cases">
            {catalogFiles.map((candidate) => {
              const item = live.credits[candidate];
              const analyzed = all.some((e) => fileOf(live, e) === candidate) || trial?.file === candidate;
              return (
                <button key={candidate} className={`catalog-case ${candidate === file ? "selected" : ""}`} onClick={() => setSelectedFile(candidate)} aria-pressed={candidate === file}>
                  <img src={`/api/fotos/${candidate}`} alt="" loading="lazy" />
                  <span className="catalog-case-body">
                    <b>{item.condicion}</b>
                    <span>{item.valor || "ilegible"}{item.valor && cfg?.expect ? ` ${cfg.expect.unit}` : ""}</span>
                    {analyzed && <span className="muted">analizada</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {file && credit ? (
          <div className="selected-case">
            <Card title={file} aside={entry ? <Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge> : null}>
              <InspectionImage entry={entry} file={file} url={`/api/fotos/${file}`} />
              <p className="muted small photo-credit">
                {isReal(file, live) ? <><a href={credit.fuente} target="_blank" rel="noreferrer">{credit.autor}</a> · {credit.licencia}</> : `${credit.autor} · ${credit.licencia}`}
              </p>
              <div className="trial-actions">
                <button className="btn primary" onClick={analyzeCatalog} disabled={isRunning(selectedTrial)}>Analizar</button>
              </div>
              <TrialStatus run={selectedTrial} status={status} />
            </Card>

            <Card title="Resultado" className="case-result">
              {!entry ? (
                <div className="empty-result">
                  <p className="muted">{selectedTrial ? "Analizando…" : "Sin analizar"}</p>
                </div>
              ) : <ResultDetails live={live} cfg={cfg} entry={entry} file={file} imageUrl={`/api/fotos/${file}`} />}
            </Card>

            {entry && <ExecutionDetails live={live} cfg={cfg} config={config} entry={entry} />}
          </div>
        ) : <Card title="Sin casos">No hay imágenes para este filtro.</Card>}
      </section>


      <Card title="Analítica por punto">
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

      <Card title="Últimas lecturas">
        <div className="strip">
          {verdicts.filter(({ e }) => { const f = fileOf(live, e); return !f || isReal(f, live); }).slice(-18).reverse().map(({ e, v }, index) => {
            const item = payloadOf(e);
            return (
              <figure key={String(item.inspection_id ?? `${e.topic}${e.t}${index}`)} className={v.hit === false ? "bad" : qualityTone(item.quality)}>
                <Photo entry={e} small />
                <figcaption>
                  <b>{show(item.poi)}</b> {item.value === null ? "—" : show(item.value)}
                  {v.truth !== null && <span className={v.hit ? "hit" : "miss"}> {v.hit ? "✓" : `✗ ${v.truth}`}</span>}
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
      {verdict.truth !== null && <p className={`truth ${verdict.hit ? "hit" : "miss"}`}>Referencia {verdict.truth} {verdict.hit ? "✓" : "✗"}</p>}
      {p.quality === "good" && verdict.hit === false && <p className="result bad">Incorrecta aceptada</p>}
      {checks.map((check) => <p key={String(check)} className="result warn">{show(check)}</p>)}
      <div className="case-facts">
        <span>Confianza <b>{typeof p.confidence === "number" ? `${dec(p.confidence * 100, 0)} %` : "—"}</b></span>
        <span>Hora <b>{dateTime(p.processed_at ?? p.ts)}</b></span>
      </div>
      <div className="actions evidence-actions">
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
    <Card title="Ejecución" className="execution-card">
      <div className="execution-facts">
        <span>Modelo <b>{show(trace.model ?? config.model)}</b></span>
        <span>Proveedor <b>{show(trace.provider ?? config.provider)}</b></span>
        <span>Latencia <b>{typeof trace.latency_ms === "number" ? `${dec(trace.latency_ms, 0)} ms` : "—"}</b></span>
        <span>Prompt <code>{show(trace.prompt ?? config.value)}</code></span>
      </div>
      <details><summary>Prompt y esquema</summary><pre className="code">{show(trace.instruction ?? cfg?.prompt)}</pre><pre className="code">{JSON.stringify(trace.schema ?? cfg?.schema ?? {}, null, 2)}</pre></details>
      <details><summary>Respuesta del modelo</summary><pre className="code">{raw ?? "—"}</pre></details>
      {p.mode !== "ensayo" && <details><summary>Valor en el UNS</summary><pre className="code">{associatedValue ? JSON.stringify(associatedValue, null, 2) : "—"}</pre></details>}
      <details><summary>JSON completo</summary><pre className="code">{JSON.stringify(entry.payload, null, 2)}</pre></details>
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
