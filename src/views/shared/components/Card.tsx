import type { ReactNode } from "react";

/** A titled block: heading with an optional small subtitle and right-aligned actions, then the content. */
export function Card({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-header">
        <h1>
          {title}
          {subtitle ? <small>{subtitle}</small> : null}
        </h1>
        {actions}
      </header>
      {children}
    </section>
  );
}
