import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { REQUIRED_ENV_VARS } from "../utils/env.js";

const examplePath = fileURLToPath(new URL("../../.env.example", import.meta.url));
const contents = await readFile(examplePath, "utf8");
const exampleKeys = new Set(
  contents
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1])
    .filter(Boolean)
);
const missing = REQUIRED_ENV_VARS.filter((key) => !exampleKeys.has(key));

if (missing.length) {
  console.error(`Missing required keys in .env.example: ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("Environment example covers all required settings.");
}
