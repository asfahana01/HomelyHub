import { readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
const roots = [join(backendRoot, "src"), join(backendRoot, "tests")];
const files = [];

const collectJavaScript = async (directory) => {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const entryStat = await stat(path);
    if (entryStat.isDirectory()) {
      await collectJavaScript(path);
    } else if (path.endsWith(".js")) {
      files.push(path);
    }
  }
};

for (const root of roots) {
  await collectJavaScript(root);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log(`Syntax checks passed for ${files.length} JavaScript files.`);
}
