import { useState } from "react";
import { dec, qualityLabel, show } from "../format";
import { type Entry, payloadOf } from "../live";

function coordinates(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  if (value[0] >= value[2] || value[1] >= value[3]) return null;
  return value;
}

function sourceLabel(source: unknown): string {
  if (source === "model") return "Caja predicha por el modelo";
  if (source === "replay") return "Caja incluida en la respuesta grabada · replay";
  if (source === "annotated") return "Región anotada manualmente";
  return "Caja devuelta por el inspector · origen no indicado";
}

export function InspectionImage({ entry, file, url }: { entry: Entry | undefined; file: string; url: string }) {
  const [zoom, setZoom] = useState(1);
  const p = payloadOf(entry);
  const box = coordinates(p.bbox_2d);
  const reading = p.value === null || p.value === undefined ? "sin lectura" : `${show(p.value)}${p.unit ? ` ${show(p.unit)}` : ""}`;

  return (
    <figure className="inspection-image">
      <div className="image-toolbar">
        <span className="muted small">Zoom {Math.round(zoom * 100)} %</span>
        <div className="actions">
          <button className="btn small" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Reducir imagen">
            −
          </button>
          <button className="btn small" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Ampliar imagen">
            +
          </button>
          <button className="btn small" disabled={zoom === 1} onClick={() => setZoom(1)}>
            Restablecer
          </button>
        </div>
      </div>
      <div className="vision-image-viewport">
        <div className="vision-image-canvas" style={{ width: `${zoom * 100}%` }}>
          <img src={url} alt={`Caso ${file}`} />
          {box && (
            <div
              className={`bounding-box ${p.quality === "good" ? "ok" : "warn"}`}
              style={{ left: `${box[0] / 10}%`, top: `${box[1] / 10}%`, width: `${(box[2] - box[0]) / 10}%`, height: `${(box[3] - box[1]) / 10}%` }}
            >
              <span>{`${show(p.poi)} · ${reading} · ${qualityLabel(p.quality)}`}</span>
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <span>{box ? sourceLabel(p.bbox_source) : "Sin caja de localización para esta ejecución"}</span>
        {typeof p.confidence === "number" && <span>Confianza declarada: {dec(p.confidence * 100, 0)} % · no equivale a precisión medida</span>}
      </figcaption>
    </figure>
  );
}
