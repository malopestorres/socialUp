import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const profileDir = ".socialup-debug/whatsapp-desktop-session";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

const browserContext = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 980 },
  args: ["--disable-gpu", "--disable-gpu-compositing"],
});

const page = browserContext.pages()[0] ?? (await browserContext.newPage());
await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });

console.log("");
console.log("WhatsApp aberto em modo desktop.");
console.log("1. Faça login normalmente.");
console.log("2. Quando terminar, volte aqui no terminal.");
console.log("3. Pressione Enter para aplicar o modo mobile.");
console.log("");

const rl = readline.createInterface({ input, output });
await rl.question("Pressione Enter depois de logar...");
rl.close();

const client = await browserContext.newCDPSession(page);
await client.send("Emulation.setUserAgentOverride", {
  userAgent: MOBILE_USER_AGENT,
  platform: "Android",
});
await client.send("Emulation.setDeviceMetricsOverride", {
  width: 412,
  height: 915,
  deviceScaleFactor: 2.625,
  mobile: true,
  screenWidth: 412,
  screenHeight: 915,
});
await client.send("Emulation.setTouchEmulationEnabled", {
  enabled: true,
  maxTouchPoints: 5,
});

await page.reload({ waitUntil: "domcontentloaded" });

console.log("");
console.log("Modo mobile aplicado e página recarregada.");
console.log("Agora faça o fluxo manualmente e use o codegen separado para gravar.");
console.log("Deixe esta janela aberta. Feche com Ctrl+C quando terminar.");
console.log("");

await new Promise(() => {});
