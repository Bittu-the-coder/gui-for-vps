// Renders the brand images from docs/assets/logo-mark.svg: the README banner, the GitHub social preview and a PNG of
// the mark. Needs the Chromium that Playwright already uses (GFV_CHROMIUM overrides the path).
//   node scripts/make-brand.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const assets = join(root, 'docs', 'assets');
const mark = readFileSync(join(assets, 'logo-mark.svg'), 'utf8').replace(
  '<svg ',
  '<svg width="100%" height="100%" ',
);
const font = join(
  root,
  'web',
  'node_modules',
  '@fontsource-variable',
  'inter',
  'files',
  'inter-latin-wght-normal.woff2',
);

function chromiumPath() {
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

// Embedded as a data URI: a page made with setContent cannot load file:// URLs.
const fontData = readFileSync(font).toString('base64');
const css = `
  @font-face { font-family: 'InterV'; src: url(data:font/woff2;base64,${fontData}) format('woff2'); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'InterV', system-ui, sans-serif; color: #e8ecff; }
  .bg { position: absolute; inset: 0; background:
      radial-gradient(900px 500px at 12% 0%, rgba(124,92,255,.38), transparent 60%),
      radial-gradient(800px 500px at 100% 100%, rgba(20,200,192,.30), transparent 55%),
      linear-gradient(160deg, #0b1024, #101735 60%, #0b1226); }
  .grid { position: absolute; inset: 0; opacity: .5; background-image:
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%); }
  h1 { font-weight: 800; letter-spacing: -0.04em; background: linear-gradient(90deg, #ffffff, #b9c8ff 60%, #8fe9ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tag { color: #b6c0e8; font-weight: 500; }
  .pill { display: inline-block; padding: 7px 16px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14); color: #dfe6ff; font-weight: 600; letter-spacing: .01em; }
  .mark { filter: drop-shadow(0 18px 34px rgba(8,12,40,.55)); }
`;

const banner = (
  w,
  h,
  markSize,
  titleSize,
  tagSize,
  pillSize,
  vertical,
) => `<!doctype html><html><head><style>${css}
  body { width:${w}px; height:${h}px; position:relative; overflow:hidden; }
  .row { position:absolute; inset:0; display:flex; ${vertical ? 'flex-direction:column; justify-content:center; align-items:center; text-align:center; gap:22px;' : 'align-items:center; padding:0 90px; gap:56px;'} }
  .mark { width:${markSize}px; height:${markSize}px; flex:none; }
  h1 { font-size:${titleSize}px; line-height:1; }
  .tag { font-size:${tagSize}px; line-height:1.3; margin-top:${vertical ? 14 : 12}px; }
  .pills { display:flex; gap:12px; margin-top:${vertical ? 26 : 22}px; ${vertical ? 'justify-content:center;' : ''} }
  .pill { font-size:${pillSize}px; }
</style></head><body><div class="bg"></div><div class="grid"></div>
<div class="row"><div class="mark">${mark}</div>
<div><h1>GFV</h1><p class="tag">A desktop in your browser for the<br/>Linux servers you actually run</p>
<div class="pills"><span class="pill">It teaches</span><span class="pill">It protects</span><span class="pill">It remembers</span></div></div></div></body></html>`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
async function render(html, w, h, file, scale = 2) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: scale,
  });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  writeFileSync(join(assets, file), await page.screenshot());
  await page.close();
}
await render(banner(1280, 340, 210, 112, 30, 20, false), 1280, 340, 'banner.png');
await render(banner(1280, 640, 190, 124, 34, 22, true), 1280, 640, 'social-preview.png', 1);
const m = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await m.setContent(
  `<body style="margin:0;background:transparent">${mark.replace('width="100%" height="100%"', 'width="512" height="512"')}</body>`,
);
writeFileSync(join(assets, 'logo-mark-512.png'), await m.screenshot({ omitBackground: true }));
await browser.close();
console.log('wrote banner.png, social-preview.png, logo-mark-512.png');
