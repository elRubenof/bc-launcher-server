import type { Loader } from "@bc-launcher-server/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/i18n";
import { loaderVersionsQuery, minecraftVersionsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const LOADERS: Loader[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];
export const LOADER_NAMES: Record<Loader, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};
const LOADER_SOURCES: Record<Loader, string> = {
  vanilla: "",
  fabric: "meta.fabricmc.net",
  quilt: "meta.quiltmc.org",
  forge: "maven.minecraftforge.net",
  neoforge: "maven.neoforged.net",
};

export interface VersionChoice {
  mcVersion: string;
  loader: Loader;
  loaderVersion: string | null;
}

/** "Fabric 0.16.9 · MC 1.21.1". */
export function versionLabel(choice: VersionChoice) {
  const loader =
    choice.loader === "vanilla"
      ? LOADER_NAMES.vanilla
      : `${LOADER_NAMES[choice.loader]} ${choice.loaderVersion ?? ""}`;
  return `${loader} · MC ${choice.mcVersion}`;
}

/**
 * Minecraft version, loader and loader version, from the official metadata (through the API).
 * `layout="wizard"` shows the loaders as cards; `layout="row"` as three selects in a row.
 */
export function VersionPicker({
  value,
  onChange,
  layout,
  disabled,
}: {
  value: VersionChoice;
  onChange: (value: VersionChoice) => void;
  layout: "wizard" | "row";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const mcId = useId();
  const loaderId = useId();
  const loaderVersionId = useId();
  const minecraft = useQuery(minecraftVersionsQuery);
  const loaderVersions = useQuery(loaderVersionsQuery(value.loader, value.mcVersion));
  const versions = loaderVersions.data?.versions;

  // Pick the recommended loader version when the list changes and the current one isn't in it.
  useEffect(() => {
    if (value.loader === "vanilla") {
      if (value.loaderVersion !== null) onChange({ ...value, loaderVersion: null });
      return;
    }
    if (!versions) return;
    if (versions.some((v) => v.version === value.loaderVersion)) return;
    const pick = versions.find((v) => v.recommended) ?? versions[0];
    onChange({ ...value, loaderVersion: pick?.version ?? null });
  }, [versions, value, onChange]);

  // The current version stays selectable even if it isn't a release (or the list failed).
  const mcOptions = minecraft.data?.versions.map((v) => v.id) ?? [];
  if (value.mcVersion && !mcOptions.includes(value.mcVersion)) mcOptions.unshift(value.mcVersion);

  const loaderLabel = t("version.loaderVersion", { loader: LOADER_NAMES[value.loader] });
  const loaderVersionField =
    value.loader === "vanilla" ? null : (
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={loaderVersionId}>{loaderLabel}</Label>
        <Select
          id={loaderVersionId}
          value={value.loaderVersion ?? ""}
          disabled={disabled || !versions || versions.length === 0}
          onChange={(event) => onChange({ ...value, loaderVersion: event.target.value })}
        >
          {!versions ? <option value="">{t("common.loading")}</option> : null}
          {versions?.length === 0 ? (
            <option value="">{t("version.noLoaderVersions")}</option>
          ) : null}
          {versions?.map((v) => (
            <option key={v.version} value={v.version}>
              {v.recommended
                ? t("version.recommended", { version: v.version })
                : v.stable
                  ? v.version
                  : t("version.unstable", { version: v.version })}
            </option>
          ))}
        </Select>
        {layout === "wizard" ? (
          <span className="text-xs text-muted-foreground">
            {loaderVersions.isError
              ? t("version.metadataUnavailable")
              : t("version.source", { source: LOADER_SOURCES[value.loader], mc: value.mcVersion })}
          </span>
        ) : loaderVersions.isError ? (
          <span className="text-xs text-destructive-foreground">
            {t("version.metadataUnavailable")}
          </span>
        ) : null}
      </div>
    );

  const mcField = (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={mcId}>{t("version.minecraft")}</Label>
      <Select
        id={mcId}
        value={value.mcVersion}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, mcVersion: event.target.value })}
      >
        {mcOptions.length === 0 ? <option value="">{t("common.loading")}</option> : null}
        {mcOptions.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </Select>
      {minecraft.isError ? (
        <span className="text-xs text-destructive-foreground">
          {t("version.metadataUnavailable")}
        </span>
      ) : null}
    </div>
  );

  if (layout === "row") {
    return (
      <>
        {mcField}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={loaderId}>{t("version.loader")}</Label>
          <Select
            id={loaderId}
            value={value.loader}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, loader: event.target.value as Loader, loaderVersion: null })
            }
          >
            {LOADERS.map((loader) => (
              <option key={loader} value={loader}>
                {LOADER_NAMES[loader]}
              </option>
            ))}
          </Select>
        </div>
        {loaderVersionField}
      </>
    );
  }

  return (
    <>
      {mcField}
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={disabled}>
        <legend className="mb-2 p-0 font-medium">{t("version.loader")}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOADERS.map((loader) => (
            <label
              key={loader}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-input px-2.5",
                "has-checked:border-primary has-checked:bg-secondary has-focus-visible:ring-2 has-focus-visible:ring-ring",
              )}
            >
              <input
                type="radio"
                name={loaderId}
                className="accent-primary"
                checked={value.loader === loader}
                onChange={() => onChange({ ...value, loader, loaderVersion: null })}
              />
              {LOADER_NAMES[loader]}
            </label>
          ))}
        </div>
      </fieldset>
      {loaderVersionField}
    </>
  );
}
