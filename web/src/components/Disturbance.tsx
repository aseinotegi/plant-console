import { useState } from "react";

/** Starts the pressure surge now instead of waiting for the next one in the scenario. */
export function DisturbanceButton() {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/escenario/perturbacion", { method: "POST" });
      setNote(r.ok ? "Perturbación en marcha: la presión empieza a subir" : "Ya hay una perturbación en curso");
    } catch {
      setNote("El simulador no responde");
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 6000);
    }
  };
  return (
    <div className="disturb">
      <button onClick={run} disabled={busy} className="btn warn">
        Provocar sobrepresión
      </button>
      {note && <span className="note">{note}</span>}
    </div>
  );
}
