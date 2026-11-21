import type { ReactNode } from "react";
import type { Tone } from "../format";

export function Card({
  title,
  aside,
  children,
  className,
  tour,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tour?: string; // a stop of the first-visit tour
}) {
  return (
    <section className={`card ${className ?? ""}`} data-tour={tour}>
      {(title || aside) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: Tone | "live"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="dot-label" title={on ? `${label}: conectado` : `${label}: sin conexión`}>
      <span className={`dot ${on ? "on" : "off"}`} />
      {label}
    </span>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
    </div>
  );
}
