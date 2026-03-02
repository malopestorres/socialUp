import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { JobDto } from "@socialup/shared";

let browserContextPromise: Promise<BrowserContext> | null = null;
export type SocialPlatform = "instagram" | "whatsapp";
type InstagramMode = "desktop" | "story-mobile";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const MOBILE_VIEWPORT = {
  width: 430,
  height: 932,
  deviceScaleFactor: 3,
  mobile: true,
};
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1";

function getUserDataDir(): string {
  return path.join(app.getPath("userData"), "playwright-profile");
}

async function ensureBrowserContext(): Promise<BrowserContext> {
  if (browserContextPromise) {
    try {
      const existingContext = await browserContextPromise;
      existingContext.pages();
      return existingContext;
    } catch {
      browserContextPromise = null;
    }
  }

  browserContextPromise = chromium.launchPersistentContext(getUserDataDir(), {
    headless: false,
    viewport: DESKTOP_VIEWPORT,
    args: ["--start-minimized", "--disable-gpu", "--disable-gpu-compositing"],
  });

  const context = await browserContextPromise;
  context.on("close", () => {
    browserContextPromise = null;
  });

  return context;
}

async function getOrCreatePage(context: BrowserContext, key: "instagram" | "whatsapp"): Promise<Page> {
  const existing = context.pages().find((page) => page.url().includes(key));
  if (existing) {
    return existing;
  }

  const page = await context.newPage();
  if (key === "instagram") {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  } else {
    await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });
  }
  return page;
}

async function applyInstagramMode(page: Page, mode: InstagramMode): Promise<void> {
  const session = await page.context().newCDPSession(page);
  const nextMode = page.url().includes("__su_mobile_story=1") ? "story-mobile" : "desktop";

  if (nextMode === mode && page.url().includes("instagram.com")) {
    return;
  }

  if (mode === "story-mobile") {
    await session.send("Emulation.setDeviceMetricsOverride", MOBILE_VIEWPORT);
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    await session.send("Emulation.setUserAgentOverride", {
      userAgent: MOBILE_USER_AGENT,
      platform: "iPhone",
    });
    await page.goto("https://www.instagram.com/?__su_mobile_story=1", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    return;
  }

  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: false,
    maxTouchPoints: 0,
  });
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: DESKTOP_VIEWPORT.width,
    height: DESKTOP_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.send("Emulation.setUserAgentOverride", {
    userAgent: DESKTOP_USER_AGENT,
    platform: "macOS",
  });
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
}

export async function openPlatformSession(platform: SocialPlatform): Promise<void> {
  const context = await ensureBrowserContext();
  const page = await getOrCreatePage(context, platform);
  await page.bringToFront();
}

export async function openLoginSessions(): Promise<void> {
  const context = await ensureBrowserContext();
  const instagramPage = await getOrCreatePage(context, "instagram");
  const whatsappPage = await getOrCreatePage(context, "whatsapp");
  await instagramPage.bringToFront();
  await whatsappPage.bringToFront();
}

async function findFirstVisible(candidates: Locator[], timeoutMs = 8_000): Promise<Locator | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates) {
      const target = candidate.first();
      if (await target.isVisible().catch(() => false)) {
        return target;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function clickFirstVisible(candidates: Locator[], timeoutMs = 8_000): Promise<Locator> {
  const target = await findFirstVisible(candidates, timeoutMs);
  if (!target) {
    throw new Error("WHATSAPP_SELECTOR_NOT_FOUND");
  }

  await target.click();
  return target;
}

async function fillFirstVisible(candidates: Locator[], value: string, timeoutMs = 8_000): Promise<Locator> {
  const target = await findFirstVisible(candidates, timeoutMs);
  if (!target) {
    throw new Error("WHATSAPP_TEXT_EDITOR_NOT_FOUND");
  }

  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  await target.click();
  await target.fill(value);
  return target;
}

async function fillWhatsappComposerField(page: Page, candidates: Locator[], value: string, timeoutMs = 12_000): Promise<Locator> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const target = await findFirstVisible(candidates, 600);
    if (target) {
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await target.click().catch(() => undefined);
      await target.fill(value);
      return target;
    }

    await page.mouse.wheel(0, 700).catch(() => undefined);
    await page.keyboard.press("PageDown").catch(() => undefined);
  }

  throw new Error("WHATSAPP_TEXT_EDITOR_NOT_FOUND");
}

async function prepareWhatsappViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1100 }).catch(() => undefined);
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }).catch(() => undefined);
}

async function zoomOutForWhatsappComposer(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 0.72 }).catch(() => undefined);
  await page
    .evaluate(() => {
      document.documentElement.style.zoom = "0.72";
      document.body.style.zoom = "0.72";
    })
    .catch(() => undefined);
}

export async function closePlatformSession(platform: SocialPlatform): Promise<void> {
  const context = await ensureBrowserContext();
  const target = context.pages().find((page) =>
    platform === "instagram" ? page.url().includes("instagram.com") : page.url().includes("whatsapp.com"),
  );

  if (target) {
    await target.close();
  }
}

async function downloadJobMedia(job: JobDto, apiBaseUrl: string): Promise<string> {
  const response = await fetch(`${apiBaseUrl}${job.filePath}`);
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = path.extname(job.filePath) || ".bin";
  const tempFile = path.join(os.tmpdir(), `socialup-${job.id}${extension}`);
  await fs.writeFile(tempFile, buffer);
  return tempFile;
}

export async function executeJob(job: JobDto, apiBaseUrl: string): Promise<void> {
  const context = await ensureBrowserContext();
  const requiresFile = job.publicationType !== "whatsapp_status_texto";
  const absoluteFile = requiresFile ? await downloadJobMedia(job, apiBaseUrl) : "";

  if (job.publicationType.startsWith("instagram_") || job.postStory || job.postReel) {
    const instagramPage = await getOrCreatePage(context, "instagram");
    await handleInstagram(instagramPage, job, absoluteFile);
  }

  if (job.publicationType.startsWith("whatsapp_") || job.postWhatsapp) {
    const whatsappPage = await getOrCreatePage(context, "whatsapp");
    await handleWhatsapp(whatsappPage, job, absoluteFile, apiBaseUrl);
  }
}

async function runInstagramPost(page: Page, job: JobDto, absoluteFile: string): Promise<void> {
  if (!job.caption?.trim()) {
    throw new Error("INSTAGRAM_CAPTION_REQUIRED");
  }

  if (!job.locationName?.trim()) {
    throw new Error("INSTAGRAM_LOCATION_REQUIRED");
  }

  await page.getByRole("link", { name: "Novo post Criar" }).click();
  await page.getByRole("link", { name: "Postar Postar" }).click();

  await page.locator('input[type="file"]').setInputFiles(absoluteFile);

  await page.getByRole("button", { name: "Avançar" }).click();
  await page.getByRole("button", { name: "Avançar" }).click();

  await page.getByRole("textbox", { name: "Escreva uma legenda..." }).fill(job.caption);

  const locationInput = page.getByRole("textbox", { name: "Adicionar localização" });
  await locationInput.fill(job.locationName);

  const locationSuggestions = page
    .getByRole("button")
    .filter({ hasText: new RegExp(job.locationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });

  await locationSuggestions.first().waitFor({ state: "visible", timeout: 10_000 });
  await locationSuggestions.first().click();

  await page.getByRole("button", { name: "Acessibilidade Ícone de seta" }).click();
  await page.getByRole("textbox", { name: "Escrever texto alternativo..." }).fill(job.caption);

  await page.getByRole("button", { name: "Compartilhar", exact: true }).click();
  await page
    .getByRole("heading", { name: "Post compartilhado" })
    .waitFor({ state: "visible", timeout: 15_000 });

  const closeButton = page.getByRole("button", { name: "Fechar" });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

async function runInstagramReel(page: Page, job: JobDto, absoluteFile: string): Promise<void> {
  // TODO: cole aqui a gravacao refinada do fluxo de reel no Instagram Web (desktop).
  console.log(
    `Stub Instagram Reel pronto para o job ${job.id} com ${absoluteFile}, legenda ${job.caption ?? ""} e localizacao ${job.locationName ?? ""}`,
  );
}

async function runInstagramStory(page: Page, job: JobDto, absoluteFile: string): Promise<void> {
  // TODO: cole aqui a gravacao refinada do fluxo de story no Instagram Web em modo mobile.
  console.log(
    `Stub Instagram Story pronto para o job ${job.id} com ${absoluteFile}, legenda ${job.caption ?? ""} e localizacao ${job.locationName ?? ""}`,
  );
}

async function runWhatsappStatusMedia(
  page: Page,
  job: JobDto,
  absoluteFile: string,
  _apiBaseUrl: string,
): Promise<void> {
  await clickFirstVisible([
    page.getByRole("button", { name: /^Status$/i }),
    page.getByRole("tab", { name: /^Status$/i }),
    page.getByRole("button", { name: /Atualiza|Updates|Status/i }),
    page.getByRole("tab", { name: /Atualiza|Updates|Status/i }),
    page.getByRole("link", { name: /Atualiza|Updates|Status/i }),
  ]);

  await clickFirstVisible([
    page.getByRole("button", { name: /Meu status/i }),
    page.getByRole("link", { name: /Meu status/i }),
  ]);

  const directFileInput = page.locator('input[type="file"]').first();
  const hasDirectInput = await directFileInput.isVisible().catch(() => false);

  if (hasDirectInput) {
    await directFileInput.setInputFiles(absoluteFile);
  } else {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10_000 }),
      clickFirstVisible([
        page.getByText(/Fotos e vídeos|Fotos e videos|Photos and videos/i),
        page.getByRole("button", { name: /Fotos e vídeos|Fotos e videos|Photos and videos/i }),
      ]),
    ]);

    await fileChooser.setFiles(absoluteFile);
  }

  await zoomOutForWhatsappComposer(page);

  if (job.caption?.trim()) {
    await fillWhatsappComposerField(
      page,
      [
        page.getByRole("textbox", { name: /Adicione uma legenda|Add a caption/i }),
        page.locator("div[contenteditable='true'][role='textbox']"),
        page.locator("div[contenteditable='true']"),
        page.locator("textarea"),
      ],
      job.caption,
      10_000,
    );
  }

  await clickFirstVisible(
    [
      page.getByRole("button", { name: /^Enviar$/i }),
      page.getByRole("button", { name: /Enviar|Send|Publicar|Post|Concluir|Done/i }),
      page.getByRole("link", { name: /Enviar|Send|Publicar|Post|Concluir|Done/i }),
    ],
    10_000,
  );

  await page
    .getByText(/Hoje às|Hoje as|Today at/i)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

async function runWhatsappStatusText(page: Page, job: JobDto, _apiBaseUrl: string): Promise<void> {
  if (!job.caption?.trim()) {
    throw new Error("WHATSAPP_TEXT_REQUIRED");
  }

  await clickFirstVisible([
    page.getByRole("tab", { name: /Atualiza|Updates|Status/i }),
    page.getByRole("button", { name: /Atualiza|Updates|Status/i }),
    page.getByRole("link", { name: /Atualiza|Updates|Status/i }),
  ]);

  await clickFirstVisible([
    page.getByRole("button", { name: /Texto|Text status|Status de texto|Text/i }),
    page.getByRole("link", { name: /Texto|Text status|Status de texto|Text/i }),
  ]);

  await fillFirstVisible(
    [
      page.getByRole("textbox"),
      page.locator("div[contenteditable='true'][role='textbox']"),
      page.locator("div[contenteditable='true']"),
      page.locator("textarea"),
    ],
    job.caption,
  );

  await clickFirstVisible([
    page.getByRole("button", { name: /Enviar|Send|Publicar|Post|Concluir|Done/i }),
    page.getByRole("link", { name: /Enviar|Send|Publicar|Post|Concluir|Done/i }),
  ]);
}

async function handleInstagram(page: Page, job: JobDto, absoluteFile: string): Promise<void> {
  const shouldUseStoryMode = job.publicationType === "instagram_story" || job.postStory;
  await applyInstagramMode(page, shouldUseStoryMode ? "story-mobile" : "desktop");

  const currentUrl = page.url();
  if (currentUrl.includes("/accounts/login")) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  await page.bringToFront();

  switch (job.publicationType) {
    case "instagram_post":
      await runInstagramPost(page, job, absoluteFile);
      return;
    case "instagram_reel":
      await runInstagramReel(page, job, absoluteFile);
      return;
    case "instagram_story":
      await runInstagramStory(page, job, absoluteFile);
      return;
    default:
      console.log(
        `Instagram pronto para executar job ${job.id} com ${absoluteFile}. Tipo legado=${job.publicationType} caption=${job.caption ?? ""} localizacao=${job.locationName ?? ""} mode=${shouldUseStoryMode ? "mobile+reload" : "desktop"}`,
      );
  }
}

async function handleWhatsapp(
  page: Page,
  job: JobDto,
  absoluteFile: string,
  apiBaseUrl: string,
): Promise<void> {
  if (!page.url().includes("whatsapp.com")) {
    await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });
  }

  const html = await page.content();
  if (html.includes("Use o WhatsApp no seu celular para escanear o codigo")) {
    throw new Error("LOGIN_REQUIRED_WHATSAPP");
  }

  await prepareWhatsappViewport(page);
  await page.bringToFront();

  switch (job.publicationType) {
    case "whatsapp_status_midia":
      await runWhatsappStatusMedia(page, job, absoluteFile, apiBaseUrl);
      return;
    case "whatsapp_status_texto":
      await runWhatsappStatusText(page, job, apiBaseUrl);
      return;
    default:
      console.log(
        `WhatsApp pronto para executar job ${job.id} tipo ${job.publicationType} com ${absoluteFile || "sem_arquivo"} em modo ${job.modoWhatsapp}. Base API ${apiBaseUrl}`,
      );
  }
}

export async function clearAutomationSessions(): Promise<void> {
  if (browserContextPromise) {
    try {
      const context = await browserContextPromise;
      await context.close();
    } catch {
      // ignore close errors
    }
    browserContextPromise = null;
  }

  await fs.rm(getUserDataDir(), { recursive: true, force: true });
}
