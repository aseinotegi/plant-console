import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A first-visit tour: a welcome, then five short stops, each one lighting up a piece of the
 * console. Always skippable (button or Esc); it only offers itself once per browser, and the
 * "?" in the header starts it again. The targets are marked with data-tour="…".
 */

interface Step {
  target: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    target: "arquitectura",
    title: "Cómo está montada",
    text: "El PLC y el robot en campo, detrás del firewall; el UNS en el centro; arriba, esta consola. Lectura y Escritura enseñan por dónde va cada dato.",
  },
  {
    target: "mapa",
    title: "Una planta en marcha",
    text: "No es una animación: el robot hace su ronda y fotografía manómetros y extintores. Una IA los lee y el PLC confirma la presión.",
  },
  {
    target: "sobrepresion",
    title: "Pruébalo tú",
    text: "Provoca una sobrepresión: la presión sube, salta la regla y el robot va a cerrar la válvula.",
  },
  {
    target: "apps",
    title: "Cada pieza, por dentro",
    text: "Cada ventana abre su aplicación.",
  },
  {
    target: "ayuda",
    title: "Eso es todo",
    text: "Si quieres volver a verlo, está aquí.",
  },
];

const KEY = "plant-console.tour";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "done";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    /* private window: it will be offered again, that is all */
  }
}

type Rect = { top: number; left: number; width: number; height: number };

function rectOf(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/** step -1: the welcome; 0..n-1: a stop; null: closed. */
export function useTour() {
  const [step, setStep] = useState<number | null>(() => (seen() ? null : -1));
  const start = useCallback(() => {
    if (location.hash.replace(/^#\/?/, "") !== "") location.hash = "#/";
    setStep(0);
  }, []);
  const close = useCallback(() => {
    markSeen();
    setStep(null);
  }, []);
  return { step, setStep, start, close };
}

export function Tour({ step, setStep, start, close }: ReturnType<typeof useTour>) {
  const [rect, setRect] = useState<Rect | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 320, h: 160 });
  const current = step !== null && step >= 0 ? STEPS[step] : null;
  const next = () => {
    if (step === null) return;
    if (step + 1 < STEPS.length) setStep(step + 1);
    else close();
  };

  // Bring the piece into view once per stop, then follow it: the page keeps updating.
  useEffect(() => {
    if (!current) return;
    const el = document.querySelector(`[data-tour="${current.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    let frame = 0;
    let last: Rect | null = null;
    const follow = () => {
      const r = rectOf(current.target);
      if (!same(r, last)) {
        last = r;
        setRect(r);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [current]);

  useLayoutEffect(() => {
    if (box.current) setBoxSize({ w: box.current.offsetWidth, h: box.current.offsetHeight });
    box.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (step >= 0 && (e.key === "ArrowRight" || e.key === "Enter")) next();
      else if (step > 0 && e.key === "ArrowLeft") setStep(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (step === null) return null;

  if (step === -1) {
    return (
      <div className="tour-veil">
        <div className="tour-box tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabIndex={-1} ref={box}>
          <h2 id="tour-title">Bienvenido a la planta 1</h2>
          <p>Todo lo que ves está funcionando ahora mismo: un robot, un PLC, una IA que lee fotos y un motor de reglas, hablando por el mismo bus de datos.</p>
          <p className="muted">¿Te lo enseño en un minuto?</p>
          <div className="tour-actions">
            <button className="btn" onClick={close}>
              Saltar
            </button>
            <button className="btn primary" onClick={start}>
              Empezar el recorrido
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The popover goes below the piece, or above it, or beside it for a piece as tall as the
  // screen (the map); never over it unless there is no other room. Always inside the screen.
  const gap = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = vh / 2 - boxSize.h / 2;
  let left = vw / 2 - boxSize.w / 2;
  if (rect) {
    const below = rect.top + rect.height + gap;
    const above = rect.top - gap - boxSize.h;
    const right = rect.left + rect.width + gap;
    const leftSide = rect.left - gap - boxSize.w;
    const besideTop = Math.min(vh - boxSize.h - 8, Math.max(8, rect.top));
    left = rect.left + rect.width / 2 - boxSize.w / 2;
    if (below + boxSize.h <= vh - 8) top = below;
    else if (above >= 8) top = above;
    else if (right + boxSize.w <= vw - 16) [top, left] = [besideTop, right];
    else if (leftSide >= 16) [top, left] = [besideTop, leftSide];
    else top = Math.min(vh - boxSize.h - 8, Math.max(8, rect.top + 8));
  }
  left = Math.min(vw - boxSize.w - 16, Math.max(16, left));
  const pad = 6;

  return (
    <div className="tour-veil clear" onClick={(e) => e.stopPropagation()}>
      {rect ? (
        <div
          className="tour-hole"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        className="tour-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        ref={box}
        style={{ top, left }}
      >
        <div className="tour-count">
          {step + 1} / {STEPS.length}
        </div>
        <h2 id="tour-title">{current!.title}</h2>
        <p id="tour-text">{current!.text}</p>
        <div className="tour-actions">
          {step + 1 < STEPS.length ? (
            <button className="btn small tour-skip" onClick={close}>
              Saltar
            </button>
          ) : (
            <span />
          )}
          <span className="tour-nav">
            {step > 0 && (
              <button className="btn small" onClick={() => setStep(step - 1)}>
                Atrás
              </button>
            )}
            <button className="btn small primary" onClick={next}>
              {step + 1 < STEPS.length ? "Siguiente" : "Terminar"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
