import { cn } from "@/lib/utils";

/** The organization's mark: its logo, or its initials while it has none. */
export function BrandMark({
  name,
  logoUrl,
  className,
}: {
  name?: string | undefined;
  logoUrl?: string | null | undefined;
  className?: string;
}) {
  const box = cn(
    "flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary font-bold text-primary-foreground",
    className,
  );
  if (logoUrl)
    return <img src={logoUrl} alt="" className={cn(box, "bg-transparent object-cover")} />;

  const initials =
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "BC";
  return (
    <div aria-hidden="true" className={box}>
      {initials}
    </div>
  );
}
