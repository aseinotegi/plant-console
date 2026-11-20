// The namespace as a taxonomy: plant › area › equipment › signal › detail, each level
// named, each branch foldable.

import { useState } from "react";
import { Badge, Card } from "../components/bits";
import { ago, clock, qualityLabel, qualityTone } from "../format";
import { type Entry, payloadOf, stamp, summary, useLive, useNow } from "../live";
import { SITE } from "../topics";

interface Node {
  name: string;
  path: string;
  depth: number;
  entry?: Entry;
  children: Map<string, Node>;
}

const SYSTEM: Record<string, string[]> = {
  robots: ["Planta", "Activos", "Robot", "Dato", "Detalle"],
  servicios: ["Planta", "Sistema", "Servicio", "Diagnóstico", "Detalle"],
  reglas: ["Planta", "Lógica", "Regla"],
  simulacion: ["Planta", "Simulación", "Dato"],
};
const PROCESS = ["Planta", "Área", "Equipo", "Señal", "Detalle"];

function level(node: Node): string {
  const area = node.path.split("/")[1];
  return (SYSTEM[area] ?? PROCESS)[node.depth] ?? "Detalle";
}

function build(entries: Entry[]): Node {
  const root: Node = { name: "", path: "", depth: -1, children: new Map() };
  for (const e of entries) {
    let node = root;
    for (const part of e.topic.split("/")) {
      const path = node.path ? `${node.path}/${part}` : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path, depth: node.depth + 1, children: new Map() });
      node = node.children.get(part)!;
    }
    node.entry = e;
  }
  return root;
}

function leaves(node: Node): number {
  return (node.entry ? 1 : 0) + [...node.children.values()].reduce((n, c) => n + leaves(c), 0);
}

function allPaths(node: Node, out: string[] = []): string[] {
  for (const c of node.children.values()) {
    if (c.children.size) out.push(c.path);
    allPaths(c, out);
  }
  return out;
}

export function UnsPage() {
  const live = useLive();
  const now = useNow();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["planta1/servicios", "planta1/simulacion", "planta1/robots/robot-01/ultima-foto"]));
  const entries = [...live.topics.values()].filter((e) => e.topic.startsWith(`${SITE}/`) && e.topic.includes(filter.trim()));
  const tree = build(entries);
  const chosen = selected ? live.get(selected) : undefined;
  const toggle = (path: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className={`uns-page ${chosen ? "with-detail" : ""}`}>
      <Card
        title="Unified Namespace"
        aside={
          <div className="actions">
            <span className="muted small">
              {entries.length} temas · {live.rate} msg/s
            </span>
            <button className="btn small" onClick={() => setFolded(new Set())}>
              Desplegar todo
            </button>
            <button className="btn small" onClick={() => setFolded(new Set(allPaths(tree).filter((p) => p.split("/").length >= 2)))}>
              Plegar todo
            </button>
          </div>
        }
      >
        <input className="filter" placeholder="Filtrar, por ejemplo pi-104" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="taxonomy">
          {[...tree.children.values()].map((n) => (
            <TreeNode key={n.path} node={n} now={now} selected={selected} onSelect={setSelected} folded={folded} onToggle={toggle} />
          ))}
        </ul>
      </Card>
      {chosen && (
        <Card
          title={chosen.topic.split("/").slice(-2).join(" / ")}
          className="detail"
          aside={
            <button className="btn small" onClick={() => setSelected(null)}>
              Cerrar
            </button>
          }
        >
          <p className="topic">{chosen.topic}</p>
          <p className="muted small">
            {clock(chosen.t)} · {ago(stamp(chosen), now)} · {chosen.retained ? "retenido" : "en vivo"}
          </p>
          <pre className="json">{JSON.stringify(chosen.payload, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}

function TreeNode({
  node,
  now,
  selected,
  onSelect,
  folded,
  onToggle,
}: {
  node: Node;
  now: number;
  selected: string | null;
  onSelect: (t: string) => void;
  folded: Set<string>;
  onToggle: (p: string) => void;
}) {
  const e = node.entry;
  const p = payloadOf(e);
  const kids = [...node.children.values()];
  const closed = folded.has(node.path);
  return (
    <li className={`lvl-${node.depth}`}>
      <div className={`node ${e && selected === e.topic ? "sel" : ""}`}>
        {kids.length > 0 ? (
          <button className="fold" onClick={() => onToggle(node.path)} aria-expanded={!closed} aria-label={closed ? "Desplegar" : "Plegar"}>
            {closed ? "▸" : "▾"}
          </button>
        ) : (
          <span className="fold" />
        )}
        <span className="level">{level(node)}</span>
        <button className="name" onClick={() => (e ? onSelect(e.topic) : onToggle(node.path))}>
          {node.name}
        </button>
        {closed && <span className="count">{leaves(node)}</span>}
        {e && (
          <>
            <span className="val">
              {summary(e)}
              {typeof p.unit === "string" ? ` ${p.unit}` : ""}
            </span>
            {typeof p.quality === "string" && p.quality !== "good" && <Badge tone={qualityTone(p.quality)}>{qualityLabel(p.quality)}</Badge>}
            <span className="age">{ago(stamp(e), now)}</span>
          </>
        )}
      </div>
      {kids.length > 0 && !closed && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.path} node={k} now={now} selected={selected} onSelect={onSelect} folded={folded} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}
