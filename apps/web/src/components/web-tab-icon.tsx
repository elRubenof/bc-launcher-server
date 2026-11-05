import type { WebTabIcon as WebTabIconName } from "@bc-launcher-server/contracts/web-tabs";
import {
  BookOpenIcon,
  CalendarIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  GlobeIcon,
  ListIcon,
  type LucideProps,
  MapIcon,
  MonitorPlayIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

/** The launcher shows the same icon for each name. */
const ICONS: Record<WebTabIconName, React.ComponentType<LucideProps>> = {
  map: MapIcon,
  trophy: TrophyIcon,
  calendar: CalendarIcon,
  book: BookOpenIcon,
  chart: ChartColumnIcon,
  live: MonitorPlayIcon,
  users: UsersIcon,
  list: ListIcon,
  form: ClipboardListIcon,
  globe: GlobeIcon,
};

export function WebTabIcon({ icon, ...props }: { icon: WebTabIconName } & LucideProps) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" {...props} />;
}
