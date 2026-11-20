import { useState } from "react";
import { Badge, Card } from "../components/bits";
import { ago, clock, qualityLabel, qualityTone } from "../format";
import { type Entry, payloadOf, stamp, summary, useLive, useNow } from "../live";
import { SITE } from "../topics";

interface Node {
  name: string;
  path: string;
  entry?: Entry;
  children: Map<string, Node>;
}

function build(entries: Entry[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const e of entries) {
    let node = root;
    for (const part of e.topic.split("/")) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
      node = node.children.get(part)!;
    }
    node.entry = e;
  }
  return root;
}

export function UnsPage() {
  const live = useLive();
  const now = useNow();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const entries = [...live.topics.values()].filter((e) => e.topic.startsWith(`${SITE}/`) && e.topic.includes(filter.trim()));
  const tree = build(entries);
  const chosen = selected ? live.get(selected) : undefined;

  return (
    <div className={`uns-page ${chosen ? "with-detail" : ""}`}>
      <Card
        title="Unified Namespace"
        aside={
          <span className="muted">
            {entries.length} temas, {live.rate} mensajes por segundo
          </span>
        }
      >
        <input className="filter" placeholder="Filtrar temas, por ejemplo pi-104" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="tree">
          {[...tree.children.values()].map((n) => (
            <TreeNode key={n.path} node={n} now={now} selected={selected} onSelect={setSelected} />
          ))}
        </ul>
      </Card>
      {chosen && (
        <Card
          title="Mensaje"
          className="detail"
          aside={
            <button className="btn small" onClick={() => setSelected(null)}>
              Cerrar
            </button>
          }
        >
          <p className="topic">{chosen.topic}</p>
          <p className="muted small">
            Recibido a las {clock(chosen.t)} ({ago(stamp(chosen), now)}), {chosen.retained ? "retenido: es estado" : "en vivo"}
          </p>
          <pre className="json">{JSON.stringify(chosen.payload, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}

function TreeNode({ node, now, selected, onSelect }: { node: Node; now: number; selected: string | null; onSelect: (t: string) => void }) {
  const e = node.entry;
  const p = payloadOf(e);
  const kids = [...node.children.values()];
  return (
    <li>
      {e ? (
        <button className={`leaf ${selected === e.topic ? "sel" : ""}`} onClick={() => onSelect(e.topic)}>
          <span className="seg">{node.name}</span>
          <span className="val">
            {summary(e)}
            {typeof p.unit === "string" ? ` ${p.unit}` : ""}
          </span>
          {typeof p.quality === "string" && p.quality !== "good" && <Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}
          <span className="age muted">{ago(stamp(e), now)}</span>
        </button>
      ) : (
        <span className="seg branch">{node.name}</span>
      )}
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.path} node={k} now={now} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}
