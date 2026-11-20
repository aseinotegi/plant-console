import type { ReactNode } from "react";
import type { Tone } from "../format";

export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || aside) && (
        <header className="card-head">
          <h2>{title}</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
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
