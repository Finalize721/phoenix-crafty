/**
 * Renders the app icons and startup logo in public/ from scripts/icons/logo.png.
 *
 *   bun run icons
 *
 * Uses Playwright's Chromium; set CHROMIUM_PATH to use another Chromium.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(root, "public");
const logo = readFileSync(join(root, "scripts/icons/logo.png")).toString(
  "base64"
);
const logoDataUrl = `data:image/png;base64,${logo}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

const render = async (size, scale = 1) => {
  const imageSize = Math.round(size * scale);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;width:${size}px;height:${size}px;background:#050414}body{display:grid;place-items:center}img{display:block;width:${imageSize}px;height:${imageSize}px;object-fit:contain}</style><img src="${logoDataUrl}" alt="">`
  );
  await page.locator("img").evaluate((image) => image.decode());
  return page.screenshot();
};

const outputs = [
  ["pwa-192x192.png", 192, 1],
  ["pwa-512x512.png", 512, 1],
  ["loading-logo.png", 512, 1],
  ["maskable-512x512.png", 512, 0.8],
  ["apple-touch-icon.png", 180, 1],
];
for (const [file, size, scale] of outputs) {
  writeFileSync(join(publicDir, file), await render(size, scale));
  console.log(`public/${file}`);
}

// favicon.ico with embedded PNGs (supported by every current browser)
const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push(await render(size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(
  join(publicDir, "favicon.ico"),
  Buffer.concat([header, ...images])
);
console.log("public/favicon.ico");

await browser.close();
