import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { organizationQuery } from "@/lib/queries";

/** Uses the organization's logo as the favicon of the public page and the panel. */
export function OrganizationFavicon() {
  const organization = useQuery(organizationQuery);
  const logoUrl = organization.data?.logoUrl ?? null;

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!logoUrl) {
      link?.remove();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.append(link);
    }
    link.href = logoUrl;
  }, [logoUrl]);

  return null;
}
