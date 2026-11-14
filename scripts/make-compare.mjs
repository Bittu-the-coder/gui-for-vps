// Builds docs/redesign/compare.html: every screen "before" and "after", side by side. Local file, no network.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(import.meta.dirname, '..', 'docs', 'redesign');
const after = process.argv[2] ?? 'ckpt5';
const names = readdirSync(join(dir, 'before'))
  .filter((f) => f.endsWith('.png'))
  .sort();
const rows = names
  .filter((f) => readdirSync(join(dir, after)).includes(f))
  .map(
    (f) => `<section><h2>${f.replace('.png', '')}</h2><div class="pair">
<figure><img loading="lazy" src="before/${f}"><figcaption>before</figcaption></figure>
<figure><img loading="lazy" src="${after}/${f}"><figcaption>after</figcaption></figure></div></section>`,
  )
  .join('\n');
writeFileSync(
  join(dir, 'compare.html'),
  `<!doctype html><meta charset="utf-8"><title>GFV redesign: before / after</title>
<style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}h1{margin:0 0 16px}h2{margin:28px 0 8px;font-size:15px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%;border-radius:8px;border:1px solid #333}
figcaption{color:#9a9a9a;font-size:12px;margin-top:4px}</style><h1>GFV redesign: before / after</h1>${rows}`,
);
console.log(`compare.html: ${names.length} screens`);
