import type { Loader, LoaderVersion, MinecraftVersion } from "@bc-launcher-server/contracts";

type Fetch = typeof fetch;

export const MOJANG_VERSION_MANIFEST =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader";
const QUILT_META = "https://meta.quiltmc.org/v3/versions/loader";
const FORGE_MAVEN = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

/** The official metadata couldn't be fetched or read. */
export class MetadataUnavailableError extends Error {
  constructor(url: string, cause?: unknown) {
    super(`Couldn't read ${url}`, { cause });
    this.name = "MetadataUnavailableError";
  }
}

const TTL_MS = 10 * 60 * 1000;
// Per fetch function, so tests with their own stub don't share entries. Failures aren't cached.
const caches = new WeakMap<Fetch, Map<string, { expires: number; value: Promise<unknown> }>>();

function cached<T>(fetchFn: Fetch, key: string, load: () => Promise<T>): Promise<T> {
  let cache = caches.get(fetchFn);
  if (!cache) {
    cache = new Map();
    caches.set(fetchFn, cache);
  }
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { expires: Date.now() + TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Fetches a URL; `null` for 400/404 (an unknown Minecraft version for the meta APIs). */
async function get(fetchFn: Fetch, url: string): Promise<Response | null> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { "User-Agent": "bc-launcher-server" } });
  } catch (error) {
    throw new MetadataUnavailableError(url, error);
  }
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new MetadataUnavailableError(url, `HTTP ${res.status}`);
  return res;
}

async function getJson(fetchFn: Fetch, url: string): Promise<unknown> {
  const res = await get(fetchFn, url);
  if (!res) return null;
  try {
    return await res.json();
  } catch (error) {
    throw new MetadataUnavailableError(url, error);
  }
}

async function getText(fetchFn: Fetch, url: string): Promise<string> {
  const res = await get(fetchFn, url);
  if (!res) throw new MetadataUnavailableError(url, "Not found");
  return res.text();
}

export function minecraftVersions(fetchFn: Fetch): Promise<MinecraftVersion[]> {
  return cached(fetchFn, "minecraft", async () => {
    const manifest = (await getJson(fetchFn, MOJANG_VERSION_MANIFEST)) as {
      versions?: MinecraftVersion[];
    } | null;
    if (!Array.isArray(manifest?.versions)) {
      throw new MetadataUnavailableError(MOJANG_VERSION_MANIFEST, "No versions");
    }
    return manifest.versions.map(({ id, type, releaseTime }) => ({ id, type, releaseTime }));
  });
}

const isPreRelease = (version: string) => /-(alpha|beta|pre|rc)/i.test(version);

/** Marks the first stable version (or the given one) as recommended. */
function withRecommended(
  versions: { version: string; stable: boolean }[],
  recommended?: string,
): LoaderVersion[] {
  const pick =
    (recommended && versions.find((v) => v.version === recommended)?.version) ??
    versions.find((v) => v.stable)?.version;
  return versions.map((v) => ({ ...v, recommended: v.version === pick }));
}

async function metaVersions(fetchFn: Fetch, base: string, mc: string) {
  const entries = (await getJson(fetchFn, `${base}/${encodeURIComponent(mc)}`)) as
    | { loader?: { version?: string; stable?: boolean } }[]
    | null;
  if (!Array.isArray(entries)) return [];
  return withRecommended(
    entries.flatMap(({ loader }) =>
      loader?.version
        ? [{ version: loader.version, stable: loader.stable ?? !isPreRelease(loader.version) }]
        : [],
    ),
  );
}

function mavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1] as string);
}

async function forgeVersions(fetchFn: Fetch, mc: string) {
  const xml = await getText(fetchFn, `${FORGE_MAVEN}/maven-metadata.xml`);
  const prefix = `${mc}-`;
  const versions = mavenVersions(xml)
    .filter((full) => full.startsWith(prefix))
    .map((full) => full.slice(prefix.length))
    .reverse();
  const promotions = (await getJson(
    fetchFn,
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
  ).catch(() => null)) as { promos?: Record<string, string> } | null;
  const recommended =
    promotions?.promos?.[`${mc}-recommended`] ?? promotions?.promos?.[`${mc}-latest`];
  return withRecommended(
    versions.map((version) => ({ version, stable: true })),
    recommended,
  );
}

/** NeoForge numbers its versions after Minecraft's: 1.21.1 → 21.1.x, 26.1 → 26.1.x. */
function neoforgePrefixes(mc: string): string[] {
  const parts = mc.split(".");
  if (parts[0] === "1" && parts[1]) return [`${parts[1]}.${parts[2] ?? "0"}.`];
  return [`${mc}.`];
}

async function neoforgeVersions(fetchFn: Fetch, mc: string) {
  const xml = await getText(fetchFn, `${NEOFORGE_MAVEN}/maven-metadata.xml`);
  const prefixes = neoforgePrefixes(mc);
  const versions = mavenVersions(xml)
    .filter((version) => prefixes.some((prefix) => version.startsWith(prefix)))
    .reverse();
  return withRecommended(versions.map((version) => ({ version, stable: !isPreRelease(version) })));
}

export function loaderVersions(
  fetchFn: Fetch,
  type: Exclude<Loader, "vanilla">,
  mc: string,
): Promise<LoaderVersion[]> {
  return cached(fetchFn, `${type}:${mc}`, () => {
    switch (type) {
      case "fabric":
        return metaVersions(fetchFn, FABRIC_META, mc);
      case "quilt":
        return metaVersions(fetchFn, QUILT_META, mc);
      case "forge":
        return forgeVersions(fetchFn, mc);
      case "neoforge":
        return neoforgeVersions(fetchFn, mc);
    }
  });
}

/**
 * Checks that the Minecraft version exists and the loader has that version for it.
 * Returns an error message, or `null` if the combination is valid.
 * Throws `MetadataUnavailableError` when the metadata can't be fetched.
 */
export async function checkVersions(
  fetchFn: Fetch,
  mc: string,
  loader: Loader,
  loaderVersion: string | null,
): Promise<string | null> {
  const minecraft = await minecraftVersions(fetchFn);
  if (!minecraft.some((version) => version.id === mc)) return `Unknown Minecraft version ${mc}`;
  if (loader === "vanilla") return null;
  const versions = await loaderVersions(fetchFn, loader, mc);
  if (!versions.some((version) => version.version === loaderVersion)) {
    return `${loader} ${loaderVersion} doesn't exist for Minecraft ${mc}`;
  }
  return null;
}
