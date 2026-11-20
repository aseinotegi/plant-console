// Rules as sentences: "if this and this, raise the alarm (and send this order); it
// clears when that". Variables come from the UNS, orders from the engine's whitelist.
// The engine is the only judge: the console sends the whole set and shows its answer.

import { useState } from "react";
import { Badge, Card } from "../components/bits";
import { dec, show, topicLabel } from "../format";
import { type Entry, payloadOf, useLive } from "../live";
import { SITE, T } from "../topics";

type Compare = "above" | "below" | "equals" | "not_equals";

interface Cond {
  topic: string;
  above?: number;
  below?: number;
  equals?: unknown;
  not_equals?: unknown;
  max_age_s?: number;
  quality?: string;
}

interface Rule {
  id: string;
  description?: string;
  mode: "notify" | "act";
  when: Cond[];
  clear_when: Cond[];
  on_trigger?: { topic: string; value: string }[];
}

interface Variable {
  topic: string;
  label: string;
  unit: string;
  kind: "number" | "bool" | "state";
  source: string;
  current: unknown;
  options: string[];
}

// The values a state can take, as they appear in this plant.
const PAIRS = [
  ["OK", "NOK"],
  ["abierta", "cerrada"],
];

function variables(entries: Entry[]): Variable[] {
  const out: Variable[] = [];
  for (const e of entries) {
    const t = e.topic;
    if (!t.startsWith(`${SITE}/`) || /\/(robots|servicios|reglas|simulacion)\//.test(`/${t.split("/").slice(1, 2)[0]}/`)) continue;
    if (t.endsWith("/inspeccion") || t.endsWith("/orden") || t.endsWith("/foto")) continue;
    const p = payloadOf(e);
    const v = p.value;
    const kind = typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : typeof v === "string" && v.length < 20 ? "state" : null;
    if (!kind) continue;
    const source = p.source === "inspector" ? "visión" : p.source === "robot-01" ? "robot" : "PLC";
    const options = kind === "state" ? (PAIRS.find((pair) => pair.includes(String(v))) ?? [String(v)]) : [];
    out.push({ topic: t, label: topicLabel(t), unit: typeof p.unit === "string" ? p.unit : "", kind, source, current: v, options });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

const compareOf = (c: Cond): Compare => (["above", "below", "equals", "not_equals"] as Compare[]).find((k) => k in c) ?? "above";
const thresholdOf = (c: Cond) => c[compareOf(c)];
const SYMBOL: Record<Compare, string> = { above: ">", below: "<", equals: "=", not_equals: "≠" };

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function orderLabel(o: { topic: string; value: string }): string {
  const device = o.topic.split("/")[2]?.toUpperCase() ?? o.topic;
  return o.value === "cerrar" ? `El robot cierra ${device}` : `${device}: ${o.value}`;
}

export function RulesPage() {
  const live = useLive();
  const engine = live.get(T.rulesConfig);
  const state = payloadOf(engine);
  const rules = (Array.isArray(state.rules) ? state.rules : []) as Rule[];
  const orders = (Array.isArray(state.orders) ? state.orders : []) as { topic: string; value: string }[];
  const vars = variables([...live.topics.values()]);
  const [editing, setEditing] = useState<{ rule: Rule; index: number } | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (next: Rule[], done: string) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/reglas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: next }) });
      const body = await r.json();
      if (r.ok) {
        setResult({ tone: "ok", text: `${done}. El motor de reglas las ha validado y ya las aplica (${body.detail}).` });
        setEditing(null);
      } else if (r.status === 504) {
        setResult({ tone: "warn", text: "El motor de reglas no ha contestado. Comprueba que el servicio rules está en marcha." });
      } else {
        setResult({ tone: "bad", text: `El motor no las ha aceptado y sigue con las anteriores: ${body.detail}` });
      }
    } catch {
      setResult({ tone: "bad", text: "La consola no responde." });
    } finally {
      setBusy(false);
    }
  };

  const save = (rule: Rule, index: number) => {
    const next = [...rules];
    if (index < 0) next.push(rule);
    else next[index] = rule;
    send(next, index < 0 ? `Regla ${rule.id} creada` : `Regla ${rule.id} guardada`);
  };

  return (
    <div className="rules-page">
      <header className="panel-head row-between">
        <div>
          <h1>Reglas</h1>
          <p className="muted">
            Cruzan variables del UNS y deciden: avisar o, además, dar una orden. Solo se pueden dar las órdenes de la lista que tiene el motor; la consola no puede inventarse ninguna.
          </p>
        </div>
        <button className="btn primary" disabled={!!editing || busy || !engine} onClick={() => setEditing({ rule: blank(vars), index: -1 })}>
          Nueva regla
        </button>
      </header>
      {result && <p className={`result ${result.tone}`}>{result.text}</p>}
      {!engine && <p className="muted">Esperando al motor de reglas…</p>}

      {editing && editing.index < 0 && (
        <Editor rule={editing.rule} isNew vars={vars} orders={orders} busy={busy} onCancel={() => setEditing(null)} onSave={(r) => save(r, -1)} />
      )}

      {rules.map((rule, index) =>
        editing && editing.index === index ? (
          <Editor key={rule.id} rule={editing.rule} vars={vars} orders={orders} busy={busy} onCancel={() => setEditing(null)} onSave={(r) => save(r, index)} />
        ) : (
          <RuleCard
            key={rule.id}
            rule={rule}
            vars={vars}
            disabled={!!editing || busy}
            onEdit={() => setEditing({ rule: structuredClone(rule), index })}
            onDelete={() => send(rules.filter((_, i) => i !== index), `Regla ${rule.id} borrada`)}
          />
        ),
      )}

      <details className="yaml">
        <summary>Ver las reglas como las guarda el motor (YAML)</summary>
        <pre className="json">{toYaml(rules)}</pre>
      </details>
    </div>
  );
}

function RuleCard({ rule, vars, disabled, onEdit, onDelete }: { rule: Rule; vars: Variable[]; disabled: boolean; onEdit: () => void; onDelete: () => void }) {
  const live = useLive();
  const status = payloadOf(live.get(`${T.rules}${rule.id}`)).value;
  const [confirm, setConfirm] = useState(false);
  return (
    <Card
      className="rule-card"
      title={rule.description || rule.id}
      aside={<Badge tone={status === "activa" ? "bad" : status === "normal" ? "ok" : "idle"}>{status === "activa" ? "Activa" : status === "normal" ? "Normal" : "Sin datos aún"}</Badge>}
    >
      <div className="sentence">
        <p>
          <span className="kw">Si</span>
          {rule.when.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="kw"> y </span>}
              <CondText c={c} vars={vars} />
            </span>
          ))}
        </p>
        <p>
          <span className="kw">entonces</span> alarma
          {rule.mode === "act" && (rule.on_trigger ?? []).map((o) => <span key={o.topic + o.value}> y <b className="order">{orderLabel(o)}</b></span>)}
        </p>
        <p>
          <span className="kw">se rearma cuando</span>
          {rule.clear_when.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="kw"> o </span>}
              <CondText c={c} vars={vars} />
            </span>
          ))}
        </p>
      </div>
      <div className="actions">
        <span className="muted small">{rule.id}</span>
        {confirm ? (
          <>
            <span className="small">¿Borrar esta regla?</span>
            <button className="btn small danger" onClick={onDelete} disabled={disabled}>
              Borrar
            </button>
            <button className="btn small" onClick={() => setConfirm(false)}>
              No
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={onEdit} disabled={disabled}>
              Editar
            </button>
            <button className="btn small" onClick={() => setConfirm(true)} disabled={disabled}>
              Borrar
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function CondText({ c, vars }: { c: Cond; vars: Variable[] }) {
  const v = vars.find((x) => x.topic === c.topic);
  const cmp = compareOf(c);
  const value = thresholdOf(c);
  const extras = [v?.source, c.quality === "good" ? "fiable" : null, c.max_age_s ? `de menos de ${c.max_age_s} s` : null].filter(Boolean);
  return (
    <>
      {" "}
      <b className="var">{v?.label ?? topicLabel(c.topic)}</b>
      {extras.length > 0 && <span className="muted"> ({extras.join(", ")})</span>} {SYMBOL[cmp]}{" "}
      <b>
        {typeof value === "number" ? dec(value, Number.isInteger(value) ? 0 : 1) : show(value)} {typeof value === "number" ? (v?.unit ?? "") : ""}
      </b>
    </>
  );
}

function blank(vars: Variable[]): Rule {
  const first = vars.find((v) => v.kind === "number");
  const cond: Cond = first ? { topic: first.topic, above: 0, max_age_s: 60 } : { topic: "", above: 0 };
  return { id: "", description: "", mode: "notify", when: [cond], clear_when: [] };
}

function Editor({
  rule,
  isNew = false,
  vars,
  orders,
  busy,
  onCancel,
  onSave,
}: {
  rule: Rule;
  isNew?: boolean;
  vars: Variable[];
  orders: { topic: string; value: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (r: Rule) => void;
}) {
  const [draft, setDraft] = useState<Rule>(rule);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Rule>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const id = isNew ? slug(draft.description ?? "") : draft.id;
    if (!id) return setError("Ponle un nombre a la regla.");
    if (!draft.when.length) return setError("Hace falta al menos una condición para que salte.");
    if (!draft.clear_when.length) return setError("Hace falta al menos una condición para que se rearme. Usa «Proponer rearme».");
    if ([...draft.when, ...draft.clear_when].some((c) => !c.topic)) return setError("Elige la variable de cada condición.");
    if (draft.mode === "act" && !(draft.on_trigger ?? []).length) return setError("Elige la orden que debe dar.");
    setError(null);
    onSave({ ...draft, id, on_trigger: draft.mode === "act" ? draft.on_trigger : undefined });
  };

  const proposeClear = () => {
    const clear = draft.when.map((c) => {
      const cmp = compareOf(c);
      const v = thresholdOf(c);
      if (cmp === "above" && typeof v === "number") return { topic: c.topic, below: round(v - Math.max(Math.abs(v) * 0.08, 0.1)) };
      if (cmp === "below" && typeof v === "number") return { topic: c.topic, above: round(v + Math.max(Math.abs(v) * 0.08, 0.1)) };
      if (cmp === "equals") return { topic: c.topic, not_equals: v };
      return { topic: c.topic, equals: v };
    });
    set({ clear_when: clear.slice(0, 1) });
  };

  return (
    <Card className="editor-card" title={isNew ? "Nueva regla" : `Editar ${draft.id}`}>
      <label className="field">
        <span>Nombre</span>
        <input value={draft.description ?? ""} placeholder="Por ejemplo: temperatura alta en la línea 104" onChange={(e) => set({ description: e.target.value })} />
        {isNew && draft.description && <span className="muted small">Identificador: {slug(draft.description)}</span>}
      </label>

      <fieldset>
        <legend>Salta cuando se cumple todo esto</legend>
        <Conditions list={draft.when} vars={vars} onChange={(when) => set({ when })} advanced />
      </fieldset>

      <fieldset>
        <legend>Se rearma cuando se cumple alguna de estas</legend>
        <Conditions list={draft.clear_when} vars={vars} onChange={(clear_when) => set({ clear_when })} />
        <button className="btn small" onClick={proposeClear} type="button">
          Proponer rearme con margen
        </button>
        <p className="muted small">Un margen entre el disparo y el rearme evita que la alarma entre y salga con el ruido de la señal.</p>
      </fieldset>

      <fieldset>
        <legend>Qué hace</legend>
        <label className="radio">
          <input type="radio" checked={draft.mode === "notify"} onChange={() => set({ mode: "notify" })} /> Solo avisar
        </label>
        <label className="radio">
          <input type="radio" checked={draft.mode === "act"} onChange={() => set({ mode: "act", on_trigger: draft.on_trigger?.length ? draft.on_trigger : orders.slice(0, 1) })} /> Avisar y dar una orden
        </label>
        {draft.mode === "act" && (
          <select
            value={draft.on_trigger?.[0] ? `${draft.on_trigger[0].topic}=${draft.on_trigger[0].value}` : ""}
            onChange={(e) => {
              const o = orders.find((x) => `${x.topic}=${x.value}` === e.target.value);
              set({ on_trigger: o ? [o] : [] });
            }}
          >
            {orders.map((o) => (
              <option key={`${o.topic}=${o.value}`} value={`${o.topic}=${o.value}`}>
                {orderLabel(o)}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      {error && <p className="result bad">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? "Enviando al motor…" : "Guardar y aplicar"}
        </button>
      </div>
    </Card>
  );
}

function Conditions({ list, vars, onChange, advanced = false }: { list: Cond[]; vars: Variable[]; onChange: (l: Cond[]) => void; advanced?: boolean }) {
  const update = (i: number, c: Cond) => onChange(list.map((x, j) => (j === i ? c : x)));
  return (
    <div className="conditions">
      {list.map((c, i) => {
        const v = vars.find((x) => x.topic === c.topic);
        const cmp = compareOf(c);
        const value = thresholdOf(c);
        const kind = v?.kind ?? (typeof value === "number" ? "number" : typeof value === "boolean" ? "bool" : "state");
        const base = { topic: c.topic, ...(c.max_age_s ? { max_age_s: c.max_age_s } : {}), ...(c.quality ? { quality: c.quality } : {}) };
        return (
          <div className="cond-row" key={i}>
            <select
              value={c.topic}
              onChange={(e) => {
                const nv = vars.find((x) => x.topic === e.target.value);
                const fresh: Cond = { topic: e.target.value };
                if (nv?.kind === "number") fresh.above = typeof nv.current === "number" ? round(nv.current) : 0;
                else if (nv?.kind === "bool") fresh.equals = true;
                else fresh.equals = nv?.options[0] ?? "";
                if (c.max_age_s) fresh.max_age_s = c.max_age_s;
                update(i, fresh);
              }}
            >
              {!v && <option value={c.topic}>{c.topic ? topicLabel(c.topic) : "Elige una variable"}</option>}
              {vars.map((x) => (
                <option key={x.topic} value={x.topic}>
                  {x.label} ({x.source}, ahora {typeof x.current === "number" ? `${dec(x.current, 1)} ${x.unit}` : show(x.current)})
                </option>
              ))}
            </select>
            <select
              value={cmp}
              onChange={(e) => {
                const k = e.target.value as Compare;
                update(i, { ...base, [k]: value } as Cond);
              }}
            >
              {kind === "number" ? (
                <>
                  <option value="above">mayor que</option>
                  <option value="below">menor que</option>
                </>
              ) : (
                <>
                  <option value="equals">es</option>
                  <option value="not_equals">no es</option>
                </>
              )}
            </select>
            {kind === "number" ? (
              <input
                type="number"
                step="any"
                value={typeof value === "number" ? value : 0}
                onChange={(e) => update(i, { ...base, [cmp]: Number(e.target.value) } as Cond)}
              />
            ) : kind === "bool" ? (
              <select value={String(value)} onChange={(e) => update(i, { ...base, [cmp]: e.target.value === "true" } as Cond)}>
                <option value="true">sí (1)</option>
                <option value="false">no (0)</option>
              </select>
            ) : (
              <select value={String(value)} onChange={(e) => update(i, { ...base, [cmp]: e.target.value } as Cond)}>
                {[...new Set([String(value), ...(v?.options ?? [])])].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            )}
            <span className="unit">{kind === "number" ? (v?.unit ?? "") : ""}</span>
            {advanced && (
              <span className="cond-opts">
                <label title="Solo cuenta si la lectura es fiable (por ejemplo, una foto nítida)">
                  <input type="checkbox" checked={c.quality === "good"} onChange={(e) => update(i, { ...c, quality: e.target.checked ? "good" : undefined })} /> solo fiable
                </label>
                <label title="Un valor más viejo que esto no cuenta">
                  máx.{" "}
                  <input
                    type="number"
                    min={1}
                    className="age-input"
                    value={c.max_age_s ?? ""}
                    placeholder="—"
                    onChange={(e) => update(i, { ...c, max_age_s: e.target.value ? Number(e.target.value) : undefined })}
                  />{" "}
                  s
                </label>
              </span>
            )}
            <button className="btn small" type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Quitar condición">
              Quitar
            </button>
          </div>
        );
      })}
      <button className="btn small" type="button" onClick={() => onChange([...list, { topic: "", above: 0 }])}>
        Añadir condición
      </button>
    </div>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

function toYaml(rules: Rule[]): string {
  const value = (v: unknown) => (typeof v === "string" && /[:#{}]/.test(v) ? JSON.stringify(v) : String(v));
  const cond = (c: Cond) =>
    `  - {${Object.entries(c)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${value(v)}`)
      .join(", ")}}`;
  return [
    "rules:",
    ...rules.flatMap((r) => [
      `- id: ${r.id}`,
      ...(r.description ? [`  description: ${value(r.description)}`] : []),
      `  mode: ${r.mode}`,
      "  when:",
      ...r.when.map(cond),
      "  clear_when:",
      ...r.clear_when.map(cond),
      ...(r.on_trigger?.length ? ["  on_trigger:", ...r.on_trigger.map((o) => `  - {topic: ${o.topic}, value: ${o.value}}`)] : []),
      "",
    ]),
  ].join("\n");
}
