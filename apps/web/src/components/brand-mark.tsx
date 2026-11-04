import { cn } from "@/lib/utils";

/** The organization's mark: its initials until a logo can be uploaded. */
export function BrandMark({ name, className }: { name?: string | undefined; className?: string }) {
  const initials =
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "BC";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary font-bold text-primary-foreground",
        className,
      )}
    >
      {initials}
    </div>
  );
}
