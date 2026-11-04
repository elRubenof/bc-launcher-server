import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";
import { SERVER_VERSION } from "../src/version";

/** Writes the OpenAPI document of every route to packages/contracts/openapi.json. */
const output = fileURLToPath(new URL("../../../packages/contracts/openapi.json", import.meta.url));

const app = createApp(() => {
  throw new Error("Generating the OpenAPI document doesn't handle requests");
});

const document = app.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "BC Launcher Server", version: SERVER_VERSION },
});

await writeFile(output, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${output}`);
