import { type Entry, payloadOf, useLive } from "../live";

/** The photo behind an inspection, with its author and licence when it is a real one. */
export function Photo({ entry, small = false }: { entry: Entry | undefined; small?: boolean }) {
  const live = useLive();
  const p = payloadOf(entry);
  const url = typeof p.image === "string" ? live.photos.get(p.image) : undefined;
  if (!url) return <div className={`photo noimg ${small ? "small" : ""}`}>Foto no disponible todavía</div>;
  const file = url.split("/").pop() ?? "";
  const credit = live.credits[file];
  const real = credit && credit.licencia.startsWith("CC");
  return (
    <figure className={`photo-frame ${small ? "small" : ""}`}>
      <img className="photo" src={url} alt={`Foto de ${String(p.poi ?? "")}`} loading="lazy" />
      {!small && (
        <figcaption>
          {real ? (
            <>
              Foto real de{" "}
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
