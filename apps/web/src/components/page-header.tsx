import type { ReactNode } from "react";

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="m-0 text-[26px] font-bold">{title}</h1>
      {description ? <p className="m-0 text-muted-foreground">{description}</p> : null}
    </header>
  );
}
