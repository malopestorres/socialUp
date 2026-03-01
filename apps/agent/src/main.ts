import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, screen } from "electron";
import type { JobDto, PairingResponse } from "@socialup/shared";
import {
  closePlatformSession,
  clearAutomationSessions,
  executeJob,
  openLoginSessions,
  openPlatformSession,
  type SocialPlatform,
} from "./automation.js";
import {
  addPlatformToConfig,
  clearConfig,
  exportBackupFile,
  getConfigPath,
  getOrCreateDeviceIdentity,
  importBackupFile,
  readConfig,
  removePlatformFromConfig,
  writeConfig,
  type AgentBackupFile,
  type AgentConfig,
} from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let poller: NodeJS.Timeout | null = null;
let currentConfig: AgentConfig | null = null;
let runningJobId: string | null = null;
let lastStatusMessage = "Inicializando agent.";

function snapshotState() {
  return {
    config: currentConfig,
    configPath: getConfigPath(),
    runningJobId,
    lastStatusMessage,
  };
}

function publishState(): void {
  mainWindow?.webContents.send("agent:state", snapshotState());
}

function resolveRendererPath(): string {
  const distRenderer = path.resolve(__dirname, "renderer.html");
  if (fs.existsSync(distRenderer)) {
    return distRenderer;
  }

  return path.resolve(__dirname, "../src/renderer.html");
}

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const horizontalMargin = Math.max(24, Math.floor(width * 0.06));
  const verticalMargin = Math.max(24, Math.floor(height * 0.06));
  const windowWidth = Math.max(720, width - horizontalMargin * 2);
  const windowHeight = Math.max(560, height - verticalMargin * 2);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    title: "SocialUp Agent",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  void mainWindow.loadFile(resolveRendererPath());
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

async function clearCurrentPairing(reason: string): Promise<void> {
  currentConfig = null;
  runningJobId = null;
  await clearAutomationSessions();
  await clearConfig();
  sendStatus(reason);
  publishState();
}

async function agentRequest<T>(config: AgentConfig, pathName: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${pathName}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "x-agent-token": config.agentToken,
      "x-agent-device-id": config.deviceId,
    },
  });

  if (response.status === 401) {
    await clearCurrentPairing("Acesso revogado ou invalido no backend. Este computador foi desconectado.");
    throw new Error("Acesso revogado ou inválido. Ative novamente este dispositivo com uma nova chave.");
  }

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

async function pairAgent(apiBaseUrl: string, activationCode: string): Promise<PairingResponse> {
  const deviceIdentity = await getOrCreateDeviceIdentity();
  return http<PairingResponse>(`${apiBaseUrl}/agent/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      activationCode,
      deviceId: deviceIdentity.deviceId,
      deviceName: deviceIdentity.deviceName,
    }),
  });
}

async function fetchNextJob(config: AgentConfig): Promise<JobDto | null> {
  const response = await agentRequest<{ job: JobDto | null }>(config, "/agent/jobs/next");
  return response.job;
}

async function postJobState(
  config: AgentConfig,
  jobId: string,
  action: "start" | "complete" | "fail" | "waiting-login",
  payload?: unknown,
): Promise<void> {
  await agentRequest(config, `/agent/jobs/${jobId}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : "{}",
  });
}

async function validateStoredPairing(config: AgentConfig): Promise<boolean> {
  try {
    await agentRequest(config, "/agent/me");
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Acesso revogado ou invalido")) {
      return false;
    }
    throw error;
  }
}

async function pollJobs(): Promise<void> {
  if (!currentConfig || runningJobId) {
    return;
  }

  try {
    const job = await fetchNextJob(currentConfig);
    if (!job) {
      sendStatus("Nenhum job pendente no momento.");
      return;
    }

    runningJobId = job.id;

    try {
      const requiresInstagram =
        job.publicationType.startsWith("instagram_") || job.postStory || job.postReel;
      const requiresWhatsapp =
        job.publicationType.startsWith("whatsapp_") || job.postWhatsapp;

      if (requiresInstagram && !currentConfig.enabledPlatforms.includes("instagram")) {
        throw new Error("INSTAGRAM_NAO_HABILITADO_NESTE_AGENT");
      }

      if (requiresWhatsapp && !currentConfig.enabledPlatforms.includes("whatsapp")) {
        throw new Error("WHATSAPP_NAO_HABILITADO_NESTE_AGENT");
      }

      await executeJob(job, currentConfig.apiBaseUrl);
      await postJobState(currentConfig, job.id, "complete");
      sendStatus(`Job ${job.id} concluído.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      if (message === "LOGIN_REQUIRED_INSTAGRAM" || message === "LOGIN_REQUIRED_WHATSAPP") {
        await postJobState(currentConfig, job.id, "waiting-login");
        sendStatus(`Job ${job.id} pausado aguardando login manual.`);
      } else if (message === "INSTAGRAM_NAO_HABILITADO_NESTE_AGENT" || message === "WHATSAPP_NAO_HABILITADO_NESTE_AGENT") {
        await postJobState(currentConfig, job.id, "fail", {
          error: message,
          retryable: false,
        });
        sendStatus(`Job ${job.id} bloqueado: ${message}`);
      } else {
        await postJobState(currentConfig, job.id, "fail", {
          error: message,
          retryable: true,
        });
        sendStatus(`Job ${job.id} falhou: ${message}`);
      }
    }
  } catch (error) {
    sendStatus(error instanceof Error ? error.message : "Erro de polling");
  } finally {
    runningJobId = null;
  }
}

function startPolling(): void {
  if (poller) {
    clearInterval(poller);
  }
  poller = setInterval(() => {
    void pollJobs();
  }, 10_000);
}

function sendStatus(message: string): void {
  lastStatusMessage = message;
  mainWindow?.webContents.send("agent:status", message);
  publishState();
}

app.whenReady().then(async () => {
  createWindow();
  currentConfig = await readConfig();
  if (currentConfig) {
    try {
      const isValid = await validateStoredPairing(currentConfig);
      if (isValid) {
      sendStatus(`Agent carregado: ${currentConfig.agentName}. Abra os canais habilitados para validar login.`);
        startPolling();
      }
    } catch (error) {
      sendStatus(error instanceof Error ? error.message : "Falha ao validar ativação na inicialização.");
    }
  } else {
    sendStatus("Aguardando chave de ativação.");
  }
});

ipcMain.handle("agent:get-state", async () => {
  const deviceIdentity = await getOrCreateDeviceIdentity();
  currentConfig = await readConfig();
  if (currentConfig) {
    try {
      const isValid = await validateStoredPairing(currentConfig);
      if (!isValid) {
        return {
          ...snapshotState(),
          deviceIdentity,
        };
      }
    } catch (error) {
      sendStatus(error instanceof Error ? error.message : "Falha ao validar ativação.");
    }
  }
  return {
    ...snapshotState(),
    deviceIdentity,
  };
});

ipcMain.handle("agent:test-connection", async (_event, payload: { apiBaseUrl: string }) => {
  const apiBaseUrl = payload.apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Backend respondeu HTTP ${response.status}`);
  }

  const data = (await response.json()) as { ok?: boolean };
  if (!data.ok) {
    throw new Error("Backend respondeu sem health OK.");
  }

  sendStatus(`Conexão OK com ${apiBaseUrl}.`);
  return { ok: true };
});

ipcMain.handle("agent:open-platform", async (_event, payload: { platform: SocialPlatform }) => {
  if (!currentConfig) {
    throw new Error("Ative o dispositivo antes de abrir plataformas.");
  }

  await openPlatformSession(payload.platform);
  const label = payload.platform === "instagram" ? "Instagram" : "WhatsApp";
  sendStatus(`${label} aberto para login manual.`);
  return { ok: true };
});

ipcMain.handle("agent:open-logins", async () => {
  if (!currentConfig) {
    throw new Error("Ative o dispositivo antes de abrir plataformas.");
  }

  if (currentConfig.enabledPlatforms.length === 0) {
    throw new Error("Adicione ao menos um canal antes de abrir as plataformas.");
  }

  if (currentConfig.enabledPlatforms.includes("instagram") && currentConfig.enabledPlatforms.includes("whatsapp")) {
    await openLoginSessions();
    sendStatus("Instagram e WhatsApp abertos para login manual.");
    return { ok: true };
  }

  await openPlatformSession(currentConfig.enabledPlatforms[0]);
  const label = currentConfig.enabledPlatforms[0] === "instagram" ? "Instagram" : "WhatsApp";
  sendStatus(`${label} aberto para login manual.`);
  return { ok: true };
});

ipcMain.handle("agent:poll-once", async () => {
  await pollJobs();
  return { ok: true, runningJobId, lastStatusMessage };
});

ipcMain.handle("agent:pair", async (_event, payload: { apiBaseUrl: string; token: string }) => {
  const apiBaseUrl = payload.apiBaseUrl.replace(/\/$/, "");
  const deviceIdentity = await getOrCreateDeviceIdentity();
  const pairing = await pairAgent(apiBaseUrl, payload.token);
  currentConfig = {
    apiBaseUrl,
    agentId: pairing.agentId,
    agentToken: pairing.agentToken,
    companyId: pairing.companyId,
    agentName: pairing.agentName,
    deviceId: deviceIdentity.deviceId,
    deviceName: deviceIdentity.deviceName,
    enabledPlatforms: currentConfig?.enabledPlatforms ?? [],
  };
  await writeConfig(currentConfig);
  sendStatus(`Dispositivo ativado para ${pairing.agentName}. Agora habilite os canais desejados abaixo.`);
  startPolling();
  return currentConfig;
});

ipcMain.handle("agent:export-backup", async () => {
  const backup = await exportBackupFile();
  if (!backup) {
    throw new Error("Nenhum acesso ativo para exportar.");
  }

  const result = await dialog.showSaveDialog({
    title: "Salvar backup do SocialUp Agent",
    defaultPath: "socialup-agent-backup.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), "utf8");
  sendStatus(`Backup salvo em ${result.filePath}.`);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("agent:import-backup", async () => {
  const result = await dialog.showOpenDialog({
    title: "Importar backup do SocialUp Agent",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const raw = fs.readFileSync(result.filePaths[0], "utf8");
  const backup = JSON.parse(raw) as AgentBackupFile;
  const deviceIdentity = await getOrCreateDeviceIdentity();

  if (backup.config.deviceId !== deviceIdentity.deviceId) {
    return {
      canceled: false,
      needsReactivation: true,
      apiBaseUrl: backup.config.apiBaseUrl,
      enabledPlatforms: backup.config.enabledPlatforms,
    };
  }

  currentConfig = await importBackupFile(backup);
  sendStatus(`Backup restaurado para ${currentConfig.agentName}.`);
  startPolling();
  return { canceled: false, config: currentConfig };
});

ipcMain.handle("agent:add-platform", async (_event, payload: { platform: SocialPlatform }) => {
  const config = await addPlatformToConfig(payload.platform);
  if (!config) {
    throw new Error("Ative o dispositivo antes de habilitar canais.");
  }

  currentConfig = config;
  await openPlatformSession(payload.platform);
  const label = payload.platform === "instagram" ? "Instagram" : "WhatsApp";
  sendStatus(`${label} habilitado e aberto para login manual.`);
  return currentConfig;
});

ipcMain.handle("agent:remove-platform", async (_event, payload: { platform: SocialPlatform }) => {
  const config = await removePlatformFromConfig(payload.platform);
  if (!config) {
    throw new Error("Nenhum dispositivo ativo neste computador.");
  }

  currentConfig = config;
  await closePlatformSession(payload.platform);
  const label = payload.platform === "instagram" ? "Instagram" : "WhatsApp";
  sendStatus(`${label} removido da lista de canais habilitados.`);
  return currentConfig;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
