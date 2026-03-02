import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SocialPlatform } from "./automation.js";

export interface AgentConfig {
  apiBaseUrl: string;
  agentId: string;
  agentToken: string;
  companyId: string;
  agentName: string;
  deviceId: string;
  deviceName: string;
  enabledPlatforms: SocialPlatform[];
  loginRequiredPlatforms: SocialPlatform[];
}

export interface AgentBackupFile {
  version: 1;
  exportedAt: string;
  config: AgentConfig;
}

const configDir = path.join(os.homedir(), ".socialup-agent");
const configPath = path.join(configDir, "config.json");
const devicePath = path.join(configDir, "device.json");

export async function readConfig(): Promise<AgentConfig | null> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (
      !parsed.apiBaseUrl ||
      !parsed.agentId ||
      !parsed.agentToken ||
      !parsed.companyId ||
      !parsed.agentName ||
      !parsed.deviceId
    ) {
      return null;
    }

    return {
      apiBaseUrl: parsed.apiBaseUrl,
      agentId: parsed.agentId,
      agentToken: parsed.agentToken,
      companyId: parsed.companyId,
      agentName: parsed.agentName,
      deviceId: parsed.deviceId,
      deviceName: parsed.deviceName ?? os.hostname(),
      enabledPlatforms: Array.isArray(parsed.enabledPlatforms) ? parsed.enabledPlatforms : [],
      loginRequiredPlatforms: Array.isArray(parsed.loginRequiredPlatforms) ? parsed.loginRequiredPlatforms : [],
    };
  } catch {
    return null;
  }
}

export async function writeConfig(config: AgentConfig): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function getConfigPath(): string {
  return configPath;
}

export async function getOrCreateDeviceIdentity(): Promise<{ deviceId: string; deviceName: string }> {
  await fs.mkdir(configDir, { recursive: true });

  try {
    const raw = await fs.readFile(devicePath, "utf8");
    const parsed = JSON.parse(raw) as { deviceId?: string; deviceName?: string };
    if (parsed.deviceId) {
      return {
        deviceId: parsed.deviceId,
        deviceName: parsed.deviceName ?? os.hostname(),
      };
    }
  } catch {
    // ignore and create below
  }

  const identity = {
    deviceId: randomUUID(),
    deviceName: os.hostname(),
  };

  await fs.writeFile(devicePath, JSON.stringify(identity, null, 2), "utf8");
  return identity;
}

export async function clearConfig(): Promise<void> {
  try {
    await fs.unlink(configPath);
  } catch {
    return;
  }
}

export async function addPlatformToConfig(platform: SocialPlatform): Promise<AgentConfig | null> {
  const config = await readConfig();
  if (!config) {
    return null;
  }

  if (!config.enabledPlatforms.includes(platform)) {
    config.enabledPlatforms.push(platform);
    if (!config.loginRequiredPlatforms.includes(platform)) {
      config.loginRequiredPlatforms.push(platform);
    }
    await writeConfig(config);
  }

  return config;
}

export async function removePlatformFromConfig(platform: SocialPlatform): Promise<AgentConfig | null> {
  const config = await readConfig();
  if (!config) {
    return null;
  }

  config.enabledPlatforms = config.enabledPlatforms.filter((item) => item !== platform);
  config.loginRequiredPlatforms = config.loginRequiredPlatforms.filter((item) => item !== platform);
  await writeConfig(config);
  return config;
}

export async function exportBackupFile(): Promise<AgentBackupFile | null> {
  const config = await readConfig();
  if (!config) {
    return null;
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config,
  };
}

export async function importBackupFile(backup: AgentBackupFile): Promise<AgentConfig> {
  await writeConfig(backup.config);
  return backup.config;
}
