import type { Instance } from "@bc-launcher-server/contracts";
import { cn } from "@/lib/utils";

/** The instance's icon, or its initials on its primary color. */
export function InstanceIcon({
  instance,
  className,
}: {
  instance: Pick<Instance, "name" | "iconUrl" | "colors">;
  className?: string;
}) {
  const box = cn("flex size-9 shrink-0 rounded-md", className);
  if (instance.iconUrl) {
    return <img src={instance.iconUrl} alt="" className={cn(box, "object-cover")} />;
  }
  const initials = instance.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cn(box, "items-center justify-center text-[13px] font-bold")}
      style={{ background: instance.colors.primary, color: instance.colors.text }}
    >
      {initials}
    </span>
  );
}
