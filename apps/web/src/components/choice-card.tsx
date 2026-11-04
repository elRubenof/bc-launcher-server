import type * as React from "react";
import { cn } from "@/lib/utils";

interface ChoiceCardProps extends Omit<React.ComponentProps<"input">, "type"> {
  title: string;
  description: string;
}

/** A radio button presented as a selectable card, as in the panel mockups. */
export function ChoiceCard({ title, description, className, ...props }: ChoiceCardProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-2.5 rounded-[10px] border border-input p-3.5 has-checked:border-primary has-checked:bg-secondary has-disabled:cursor-default has-focus-visible:ring-2 has-focus-visible:ring-ring",
        className,
      )}
    >
      <input type="radio" className="mt-0.5 accent-primary" {...props} />
      <span className="flex flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
