import { useState } from "react";

/** Demo only: starts the pressure surge now instead of waiting for the next one. */
export function DisturbanceButton() {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/escenario/perturbacion", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      setNote(
        r.ok
          ? "Perturbación lanzada: la presión empieza a subir"
          : r.status === 429 && body.detail
            ? String(body.detail)
            : body.estado === "ya-hay-una"
            ? "Ya hay una perturbación en curso"
            : "El simulador no ha contestado",
      );
    } catch {
      setNote("La consola no responde");
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 6000);
    }
  };
  return (
    <div className="disturb" data-tour="sobrepresion">
      <button onClick={run} disabled={busy} className="btn warn">
        Provocar sobrepresión
      </button>
      {note && <span className="note">{note}</span>}
    </div>
  );
}
