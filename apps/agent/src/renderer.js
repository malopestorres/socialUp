const { ipcRenderer } = require("electron");

const form = document.getElementById("pair-form");
const apiBaseUrlInput = document.getElementById("apiBaseUrl");
const tokenInput = document.getElementById("token");
const statusNode = document.getElementById("status");
const pairStateNode = document.getElementById("pair-state");
const testConnectionButton = document.getElementById("test-connection");
const pollOnceButton = document.getElementById("poll-once");
const addWhatsappButton = document.getElementById("add-whatsapp");
const addInstagramButton = document.getElementById("add-instagram");
const platformListNode = document.getElementById("platform-list");
const exportBackupButton = document.getElementById("export-backup");
const importBackupButton = document.getElementById("import-backup");
const pendingButtons = new WeakSet();

function setStatus(message) {
  statusNode.textContent = message;
}

function updatePlatformButtons(config) {
  const enabledPlatforms = config?.enabledPlatforms ?? [];
  const whatsappEnabled = enabledPlatforms.includes("whatsapp");
  const instagramEnabled = enabledPlatforms.includes("instagram");

  addWhatsappButton.disabled = whatsappEnabled;
  addWhatsappButton.textContent = whatsappEnabled ? "WhatsApp habilitado" : "Habilitar WhatsApp";
  addWhatsappButton.className = whatsappEnabled ? "enabled-button" : "";

  addInstagramButton.disabled = instagramEnabled;
  addInstagramButton.textContent = instagramEnabled ? "Instagram habilitado" : "Habilitar Instagram";
  addInstagramButton.className = instagramEnabled ? "enabled-button" : "secondary";
}

async function runWithButtonLock(button, task) {
  if (!button || pendingButtons.has(button)) {
    return;
  }

  pendingButtons.add(button);
  button.disabled = true;

  try {
    await task();
  } finally {
    pendingButtons.delete(button);
    applyState(await ipcRenderer.invoke("agent:get-state"));
  }
}

function applyState(state) {
  setPairState(state.config);
  renderPlatforms(state.config);
  updatePlatformButtons(state.config);
  setStatus(formatStateMessage(state));
  if (state.config) {
    apiBaseUrlInput.value = state.config.apiBaseUrl;
  }
}

function setPairState(config) {
  if (config) {
    pairStateNode.textContent = `Ativo: ${config.agentName}`;
  } else {
    pairStateNode.textContent = "Sem ativação";
  }
}

function platformLabel(platform) {
  return platform === "instagram" ? "Instagram" : "WhatsApp";
}

function renderPlatforms(config) {
  if (!config) {
    platformListNode.innerHTML = `<div class="muted">Ative o dispositivo primeiro para habilitar canais.</div>`;
    return;
  }

  if (!config.enabledPlatforms || config.enabledPlatforms.length === 0) {
    platformListNode.innerHTML = `<div class="muted">Nenhum canal habilitado ainda. Adicione WhatsApp e/ou Instagram.</div>`;
    return;
  }

  platformListNode.innerHTML = "";

  for (const platform of config.enabledPlatforms) {
    const item = document.createElement("div");
    item.className = "platform-item";
    const loginRequired = (config.loginRequiredPlatforms ?? []).includes(platform);

    const info = document.createElement("div");
    info.innerHTML = `<strong>${platformLabel(platform)}</strong><span class="muted">${loginRequired ? "Login pendente neste canal" : "Canal habilitado e pronto para execução"}</span>`;

    const actions = document.createElement("div");
    actions.className = "platform-actions";

    if (loginRequired) {
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "secondary";
      openButton.textContent = "Abrir para login";
      openButton.addEventListener("click", () =>
        runWithButtonLock(openButton, async () => {
          try {
            await ipcRenderer.invoke("agent:open-platform", { platform });
            setStatus(`${platformLabel(platform)} aberto para login manual.`);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Falha ao abrir canal");
          }
        }),
      );
      actions.appendChild(openButton);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "danger";
    removeButton.textContent = "Excluir";
    removeButton.addEventListener("click", () =>
      runWithButtonLock(removeButton, async () => {
        try {
          const updatedConfig = await ipcRenderer.invoke("agent:remove-platform", { platform });
          renderPlatforms(updatedConfig);
          setPairState(updatedConfig);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Falha ao remover canal");
        }
      }),
    );

    actions.appendChild(removeButton);
    item.appendChild(info);
    item.appendChild(actions);
    platformListNode.appendChild(item);
  }
}

function formatStateMessage(state) {
  if (state.config) {
    return [
      `Dispositivo ativado`,
      `Agent: ${state.config.agentName}`,
      `Company: ${state.config.companyId}`,
      `Dispositivo: ${state.config.deviceName}`,
      `API: ${state.config.apiBaseUrl}`,
      `Canais: ${state.config.enabledPlatforms?.length ? state.config.enabledPlatforms.map(platformLabel).join(", ") : "nenhum"}`,
      `Config: ${state.configPath}`,
      `Status: ${state.lastStatusMessage}`,
    ].join("\n");
  }

  return [
    `Aguardando chave de ativação.`,
    `Dispositivo local: ${state.deviceIdentity?.deviceName ?? "desconhecido"}`,
    `Config: ${state.configPath}`,
    `Status: ${state.lastStatusMessage}`,
  ].join("\n");
}

async function bootstrap() {
  const state = await ipcRenderer.invoke("agent:get-state");
  applyState(state);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runWithButtonLock(form.querySelector('button[type="submit"]'), async () => {
    try {
      const config = await ipcRenderer.invoke("agent:pair", {
        apiBaseUrl: apiBaseUrlInput.value.trim(),
        token: tokenInput.value.trim(),
      });
      setPairState(config);
      renderPlatforms(config);
      setStatus(
        `Dispositivo ativado com sucesso\nAgent: ${config.agentName}\nCompany: ${config.companyId}\nDispositivo: ${config.deviceName}\nAgora adicione os canais que este computador vai operar.`,
      );
      tokenInput.value = "";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao ativar dispositivo");
    }
  });
});

testConnectionButton.addEventListener("click", async () => {
  if (!apiBaseUrlInput.reportValidity()) {
    return;
  }

  await runWithButtonLock(testConnectionButton, async () => {
    try {
      await ipcRenderer.invoke("agent:test-connection", {
        apiBaseUrl: apiBaseUrlInput.value.trim(),
      });
      setStatus(`Backend acessível em ${apiBaseUrlInput.value.trim()}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao validar backend");
    }
  });
});

pollOnceButton.addEventListener("click", async () => {
  await runWithButtonLock(pollOnceButton, async () => {
    try {
      const result = await ipcRenderer.invoke("agent:poll-once");
      setStatus(result.lastStatusMessage || "Polling executado.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao buscar job");
    }
  });
});

addWhatsappButton.addEventListener("click", async () => {
  await runWithButtonLock(addWhatsappButton, async () => {
    try {
      const updatedConfig = await ipcRenderer.invoke("agent:add-platform", { platform: "whatsapp" });
      renderPlatforms(updatedConfig);
      setPairState(updatedConfig);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao adicionar WhatsApp");
    }
  });
});

addInstagramButton.addEventListener("click", async () => {
  await runWithButtonLock(addInstagramButton, async () => {
    try {
      const updatedConfig = await ipcRenderer.invoke("agent:add-platform", { platform: "instagram" });
      renderPlatforms(updatedConfig);
      setPairState(updatedConfig);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao adicionar Instagram");
    }
  });
});

exportBackupButton.addEventListener("click", async () => {
  await runWithButtonLock(exportBackupButton, async () => {
    try {
      const result = await ipcRenderer.invoke("agent:export-backup");
      if (!result.canceled) {
        setStatus(`Backup exportado com sucesso.\nArquivo: ${result.filePath}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao exportar backup");
    }
  });
});

importBackupButton.addEventListener("click", async () => {
  await runWithButtonLock(importBackupButton, async () => {
    try {
      const result = await ipcRenderer.invoke("agent:import-backup");
      if (!result.canceled && result.needsReactivation) {
        apiBaseUrlInput.value = result.apiBaseUrl || apiBaseUrlInput.value;
        setStatus(
          "Backup de outro computador carregado apenas como referência. Revogue o acesso anterior no painel web e use uma nova chave de ativação neste dispositivo.",
        );
        return;
      }

      if (!result.canceled && result.config) {
        setPairState(result.config);
        renderPlatforms(result.config);
        updatePlatformButtons(result.config);
        setStatus(`Backup restaurado para ${result.config.agentName}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao importar backup");
    }
  });
});

ipcRenderer.on("agent:status", (_event, message) => {
  setStatus(message);
});

ipcRenderer.on("agent:state", (_event, state) => {
  applyState(state);
});

void bootstrap();
