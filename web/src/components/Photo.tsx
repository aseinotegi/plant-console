import { show } from "../format";
import { type Entry, payloadOf, useLive } from "../live";
import { coordinates, OtherBoxes, others } from "./InspectionImage";

/** The photo behind an inspection, with its author and licence. */
export function Photo({ entry, small = false }: { entry: Entry | undefined; small?: boolean }) {
  const live = useLive();
  const p = payloadOf(entry);
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  if (!url) return <div className={`photo noimg ${small ? "small" : ""}`}>Foto no disponible todavía</div>;
  const file = url.split("/").pop() ?? "";
  const credit = live.credits[file];
  const real = credit && credit.licencia.startsWith("CC");
  // Generated images are not shown anywhere, only real photos.
  if (credit && !real) return <div className={`photo noimg ${small ? "small" : ""}`}>Foto no disponible todavía</div>;
  const box = coordinates(p.bbox_2d);
  return (
    <figure className={`photo-frame ${small ? "small" : ""}`}>
      {box && !small ? (
        <div className="photo-boxed">
          <img className="photo natural" src={url} alt={`Foto de ${String(p.poi ?? "")}`} loading="lazy" />
          <OtherBoxes boxes={others(p.other_boxes)} />
          <div
            className={`bounding-box ${p.quality === "good" ? "ok" : "warn"}`}
            style={{ left: `${box[0] / 10}%`, top: `${box[1] / 10}%`, width: `${(box[2] - box[0]) / 10}%`, height: `${(box[3] - box[1]) / 10}%` }}
          >
            <span>{`${show(p.poi)} · ${p.value === null || p.value === undefined ? "sin lectura" : `${show(p.value)}${p.unit ? ` ${show(p.unit)}` : ""}`}`}</span>
          </div>
        </div>
      ) : (
        <img className="photo" src={url} alt={`Foto de ${String(p.poi ?? "")}`} loading="lazy" />
      )}
      {!small && (
        <figcaption>
          {real ? (
            <>
              Foto de{" "}
              <a href={credit.fuente} target="_blank" rel="noreferrer">
                {credit.autor}
              </a>
              , {credit.licencia}
            </>
          ) : (
            "Foto generada para la demo"
          )}
        </figcaption>
      )}
    </figure>
  );
}
