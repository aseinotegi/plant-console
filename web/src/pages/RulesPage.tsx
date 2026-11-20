import { useEffect, useState } from "react";
import { Badge, Card, Row } from "../components/bits";
import { ago, show } from "../format";
import { payloadOf, stamp, useLive, useNow } from "../live";
import { T } from "../topics";

type Result = { tone: "ok" | "warn" | "bad"; text: string } | null;

export function RulesPage() {
  const live = useLive();
  const now = useNow();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/reglas");
    if (!r.ok) {
      setResult({ tone: "bad", text: "El fichero de reglas no está disponible en esta consola" });
      return;
    }
    const yaml = (await r.json()).yaml as string;
    setText(yaml);
    setSaved(yaml);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (text === null) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/reglas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: text }),
      });
      const body = await r.json();
      if (r.status === 200) {
        setSaved(text);
        setResult({ tone: "ok", text: `El motor ha cargado las reglas (${body.detail})` });
      } else if (r.status === 202) {
        setSaved(text);
        setResult({ tone: "warn", text: "Guardado, pero el motor de reglas no ha contestado. ¿Está en marcha?" });
      } else {
        setResult({ tone: "bad", text: `No se ha aplicado: ${body.detail}. El fichero sigue como estaba.` });
      }
    } catch {
      setResult({ tone: "bad", text: "La consola no responde" });
    } finally {
      setBusy(false);
    }
  };

  const engine = live.get(T.rulesConfig);
  const states = [...live.topics.values()].filter((e) => e.topic.startsWith(T.rules));
  const dirty = text !== null && text !== saved;

  return (
    <div className="rules-page">
      <Card
        title="config/rules.yaml"
        aside={
          <div className="actions">
            <button className="btn" onClick={() => { setText(saved); setResult(null); }} disabled={!dirty || busy}>
              Descartar
            </button>
            <button className="btn primary" onClick={save} disabled={!dirty || busy}>
              {busy ? "Aplicando…" : "Guardar y aplicar"}
            </button>
          </div>
        }
      >
        {result && <p className={`result ${result.tone}`}>{result.text}</p>}
        <textarea className="editor" spellCheck={false} value={text ?? ""} onChange={(e) => setText(e.target.value)} disabled={text === null} />
        <p className="muted small">
          El motor vigila este fichero y lo recarga al guardarlo. Si no lo acepta, la consola deja el anterior. Una regla activa sigue activa tras recargar, así que guardar no repite órdenes.
        </p>
      </Card>

      <div className="side">
        <Card title="Motor de reglas" aside={<Badge tone={payloadOf(engine).value === "error" ? "bad" : engine ? "ok" : "idle"}>{show(payloadOf(engine).value)}</Badge>}>
          <Row label="Última carga">{ago(stamp(engine), now)}</Row>
          <Row label="Reglas">{Array.isArray(payloadOf(engine).rules) ? (payloadOf(engine).rules as string[]).join(", ") : "—"}</Row>
          {payloadOf(engine).value === "error" && <p className="result bad">{show(payloadOf(engine).detail)}</p>}
        </Card>

        {states.map((s) => {
          const p = payloadOf(s);
          const inputs = (p.inputs ?? {}) as Record<string, unknown>;
          return (
            <Card key={s.topic} title={s.topic.slice(T.rules.length)} aside={<Badge tone={p.value === "activa" ? "bad" : "ok"}>{show(p.value)}</Badge>}>
              <p className="small">{show(p.description)}</p>
              <Row label="Modo">{p.mode === "act" ? "actúa (alarma y órdenes)" : "solo avisa"}</Row>
              <Row label="Cambió">{ago(stamp(s), now)}</Row>
              {Object.entries(inputs).map(([topic, value]) => (
                <Row key={topic} label={<span className="mono small">{topic.split("/").slice(-2).join("/")}</span>}>
                  <span className="mono">{show(value)}</span>
                </Row>
              ))}
            </Card>
          );
        })}

        <Card title="Chuleta">
          <pre className="json small">{`when:        todas, cada una reciente (max_age_s)
clear_when:  cualquiera la rearma
comparar:    above / below (números)
             equals / not_equals (cualquier valor)
quality:     good  → ignora fotos dudosas
mode:        notify (avisa) · act (avisa y ordena)`}</pre>
        </Card>
      </div>
    </div>
  );
}
