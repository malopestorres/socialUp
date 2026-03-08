import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseEnvLine(line: string): { key: string; value: string } | null {
  const equalsAt = line.indexOf("=");
  if (equalsAt <= 0) {
    return null;
  }

  const key = line.slice(0, equalsAt).trim();
  if (!key) {
    return null;
  }

  let value = line.slice(equalsAt + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export function loadBackendEnv(): void {
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
  ];

  const uniqueCandidates = Array.from(new Set(candidates));
  for (const candidate of uniqueCandidates) {
    loadEnvFile(candidate);
  }
}

