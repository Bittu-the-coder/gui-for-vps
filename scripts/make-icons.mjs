// Renders web/public/favicon.svg into the PNG icons the web app manifest needs (a PWA must offer 192 and
// 512 px PNGs). Run once with `node scripts/make-icons.mjs` and commit the result; it needs the Chromium
// that Playwright already uses (GFV_CHROMIUM overrides the path).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..', 'web', 'public');
const glyph = `<rect x="10" y="14" width="44" height="30" rx="4" fill="#0f172a"/><path d="M17 24l7 6-7 6" fill="none" stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M29 36h10" stroke="#e2e8f0" stroke-width="3.5" stroke-linecap="round"/><rect x="18" y="48" width="28" height="4" rx="2" fill="#bae6fd"/>`;
// "any": rounded tile. "maskable": full-bleed background with the glyph inside the safe zone (the OS crops it).
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0369a1"/>${glyph}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0369a1"/><g transform="translate(9.6 9.6) scale(0.7)">${glyph}</g></svg>`;

function findChromium() {
  if (process.env.GFV_CHROMIUM) return process.env.GFV_CHROMIUM;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const dir = existsSync(cache) && readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1);
  return dir ? join(cache, dir, 'chrome-linux64', 'chrome') : undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });
const jobs = [
  ['icons/icon-192.png', any, 192],
  ['icons/icon-512.png', any, 512],
  ['icons/maskable-512.png', maskable, 512],
  ['icons/apple-touch-icon.png', maskable, 180], // iOS rounds the corners itself
];
for (const [file, svg, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  writeFileSync(join(root, file), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log('wrote', jobs.map((j) => j[0]).join(', '));
