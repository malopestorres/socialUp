#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const envPath = path.join(repoRoot, ".env");

function parseEnvFile(content) {
  const parsed = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const equalsIndex = normalizedLine.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();
    let value = normalizedLine.slice(equalsIndex + 1);

    const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"");
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex);
      }
      value = value.trim();
    }

    parsed[key] = value.replace(/\\n/g, "\n");
  }

  return parsed;
}

if (!fs.existsSync(envPath)) {
  console.error(`Arquivo .env não encontrado em ${envPath}`);
  process.exit(1);
}

const commandArgs = process.argv.slice(2);
if (commandArgs.length === 0) {
  console.error("Uso: node scripts/run-with-root-env.mjs <comando> [args...]");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf8");
const loadedEnv = parseEnvFile(envContent);
const command = commandArgs[0];
const args = commandArgs.slice(1);

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    ...loadedEnv,
  },
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
