import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { JobDto } from "@socialup/shared";

let browserContextPromise: Promise<BrowserContext> | null = null;
export type SocialPlatform = "instagram" | "whatsapp";
type InstagramMode = "desktop" | "story-mobile";

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const MOBILE_VIEWPORT = {
  width: 430,
  height: 932,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1";

function getUserDataDir(): string {
  return path.join(app.getPath("userData"), "playwright-profile");
}

async function ensureBrowserContext(): Promise<BrowserContext> {
  if (!browserContextPromise) {
    browserContextPromise = chromium.launchPersistentContext(getUserDataDir(), {
      headless: false,
      viewport: DESKTOP_VIEWPORT,
      args: ["--start-minimized"],
    });
  }

  return browserContextPromise;
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
    isMobile: false,
    hasTouch: false,
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

async function handleInstagram(page: Page, job: JobDto, absoluteFile: string): Promise<void> {
  const shouldUseStoryMode = job.publicationType === "instagram_story" || job.postStory;
  await applyInstagramMode(page, shouldUseStoryMode ? "story-mobile" : "desktop");

  const currentUrl = page.url();
  if (currentUrl.includes("/accounts/login")) {
    throw new Error("LOGIN_REQUIRED_INSTAGRAM");
  }

  await page.bringToFront();
  console.log(`Instagram pronto para executar job ${job.id} com ${absoluteFile}`);
  console.log(
    `Tipo=${job.publicationType} caption=${job.caption ?? ""} mode=${shouldUseStoryMode ? "mobile+reload" : "desktop"}`,
  );
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

  await page.bringToFront();
  console.log(
    `WhatsApp pronto para executar job ${job.id} tipo ${job.publicationType} com ${absoluteFile || "sem_arquivo"} em modo ${job.modoWhatsapp}. Base API ${apiBaseUrl}`,
  );
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
