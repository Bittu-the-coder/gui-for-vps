// Renders the logo (docs/assets/logo-mark.svg) into the PNG icons the web app manifest needs (a PWA must offer 192 and
// 512 px PNGs). Run once with `node scripts/make-icons.mjs` and commit the result; it needs the Chromium
// that Playwright already uses (GFV_CHROMIUM overrides the path).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..', 'web', 'public');
// The logo lives in docs/assets/logo-mark.svg (and is copied to web/public/favicon.svg).
const any = readFileSync(
  join(import.meta.dirname, '..', 'docs', 'assets', 'logo-mark.svg'),
  'utf8',
);
// "maskable": the OS crops the icon to its own shape, so the gradient fills the whole square (no rounded corners) and
// the drawing is shrunk into the safe zone in the middle.
const cut = any.indexOf('<g filter');
const head = any.slice(0, cut).replaceAll('rx="58"', 'rx="0"');
const maskable = `${head}<g transform="translate(25.6 25.6) scale(0.8)">${any.slice(cut).replace('</svg>', '')}</g></svg>`;

function findChromium() {
  if (process.env.GFV_CHROMIUM) return process.env.GFV_CHROMIUM;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const dir =
    existsSync(cache) &&
    readdirSync(cache)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .at(-1);
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
  await page.setContent(
    `<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
  );
  writeFileSync(join(root, file), await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log('wrote', jobs.map((j) => j[0]).join(', '));
