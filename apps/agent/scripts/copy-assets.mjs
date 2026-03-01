import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot = path.resolve(__dirname, "..");

const assets = ["renderer.html", "renderer.js"];

await fs.mkdir(path.join(agentRoot, "dist"), { recursive: true });

for (const asset of assets) {
  await fs.copyFile(path.join(agentRoot, "src", asset), path.join(agentRoot, "dist", asset));
}
