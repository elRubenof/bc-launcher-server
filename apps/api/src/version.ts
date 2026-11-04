import packageJson from "../package.json" with { type: "json" };

/** This server's version, reported in discovery as `serverVersion`. */
export const SERVER_VERSION = packageJson.version;

/** Launcher API versions this server implements (`/api/v<n>`). */
export const API_VERSIONS = [1];
