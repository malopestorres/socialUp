#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const port = Number.parseInt(process.env.PORT || process.argv[2] || "4000", 10);

if (!Number.isFinite(port) || port <= 0) {
  console.error("Porta inválida para liberar.");
  process.exit(1);
}

function listListeningPids(targetPort) {
  const result = spawnSync("lsof", ["-tiTCP:" + targetPort, "-sTCP:LISTEN"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value !== process.pid);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminatePid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!processExists(pid)) {
      return;
    }
    await sleep(150);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!processExists(pid)) {
      return;
    }
    await sleep(100);
  }
}

async function main() {
  const pids = listListeningPids(port);

  if (pids.length === 0) {
    console.log(`Porta ${port} já está livre.`);
    return;
  }

  console.log(`Liberando porta ${port}...`);
  for (const pid of pids) {
    await terminatePid(pid);
  }

  const remaining = listListeningPids(port);
  if (remaining.length > 0) {
    console.error(`Não foi possível liberar a porta ${port}. PIDs restantes: ${remaining.join(", ")}`);
    process.exit(1);
  }

  console.log(`Porta ${port} liberada com sucesso.`);
}

await main();
