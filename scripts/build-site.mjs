// Builds the GFV website (landing page + documentation) into site/dist.
//
//   pnpm site:build
//
// The docs are generated from the Markdown files in this repository, so they never drift from what is on GitHub.
// Environment:
//   SITE_URL   Where the site will live, e.g. https://example.com or https://user.github.io/repo (default: the
//              GitHub Pages address of this repository). Used for canonical links, the sitemap and social cards.
//              A path in it (like /repo) is used as the base path automatically.
//   BASE_PATH  Override the base path if needed (usually empty for a custom domain).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'site');
const OUT = join(SRC, 'dist');
const REPO = 'Bittu-the-coder/gui-for-vps';
const GITHUB = `https://github.com/${REPO}`;
const NPM = 'https://www.npmjs.com/package/gui-for-vps';

const SITE_URL = (
  process.env.SITE_URL ?? `https://${REPO.split('/')[0].toLowerCase()}.github.io/gui-for-vps`
).replace(/\/+$/, '');
const BASE = (process.env.BASE_PATH ?? new URL(SITE_URL).pathname).replace(/\/+$/, '');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TODAY = new Date().toISOString().slice(0, 10);

const NAME = 'GFV';
const TAGLINE = 'A desktop in your browser for the Linux servers you run';
const LANDING_TITLE = 'GFV: a browser desktop for your Linux servers and VPS';
const LANDING_DESC =
  'GFV is a free, open-source web GUI for managing Linux servers over SSH. See every command before it runs, undo mistakes, and never lock yourself out.';

// ---- helpers --------------------------------------------------------------------------------------------------------
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const url = (path) => `${BASE}${path}`;
const abs = (path) => `${SITE_URL}${path}`;
const write = (rel, content) => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const hash = (file) =>
  createHash('sha1')
    .update(readFileSync(join(SRC, 'assets', file)))
    .digest('hex')
    .slice(0, 8);
const gitDate = (file) => {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return d || TODAY;
  } catch {
    return TODAY;
  }
};

/** GitHub-style heading ids, so links written for GitHub keep working. */
function slugger() {
  const seen = new Map();
  return (text) => {
    let id = text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!id) id = 'section';
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n ? `${id}-${n}` : id;
  };
}
const plain = (md) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const truncate = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

// ---- icons ----------------------------------------------------------------------------------------------------------
const iconCache = new Map();
async function iconNodes(name) {
  if (!iconCache.has(name)) {
    const dir = join(ROOT, 'web/node_modules/lucide-react/dist/esm/icons');
    let file = join(dir, `${name}.mjs`);
    // Renamed icons are one-line re-exports of the new name: follow them.
    for (let hops = 0; hops < 3; hops++) {
      const alias = /export \{ default \} from '\.\/([^']+)'/.exec(readFileSync(file, 'utf8'));
      if (!alias) break;
      file = join(dir, alias[1]);
    }
    const mod = await import(pathToFileURL(file).href);
    iconCache.set(name, mod.__iconData.node);
  }
  return iconCache.get(name);
}
const ICONS = {};
async function loadIcons(names) {
  for (const n of names) ICONS[n] = await iconNodes(n);
}
const icon = (name, cls = '') => {
  const nodes = ICONS[name];
  if (!nodes) throw new Error(`icon not loaded: ${name}`);
  const inner = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${esc(String(v))}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
};
const GITHUB_MARK =
  '<svg class="icon fill" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

// ---- documentation pages --------------------------------------------------------------------------------------------
const GUIDE = 'docs/USER_GUIDE.md';
/** Sidebar structure. `h2` pages are sections of the user guide; `file` pages are whole Markdown files. */
const NAV = [
  {
    group: 'Getting started',
    items: [
      { slug: 'install', src: GUIDE, h2: 'Starting GFV', title: 'Install and run' },
      { slug: 'first-run', src: GUIDE, h2: 'First run', title: 'First run and adding a server' },
      {
        slug: 'try-it-without-a-server',
        src: GUIDE,
        h2: 'Try it without a server',
        title: 'Try it without a server',
      },
    ],
  },
  {
    group: 'Using GFV',
    items: [
      { slug: 'desktop', src: GUIDE, h2: 'The desktop', title: 'The desktop' },
      {
        slug: 'how-changes-work',
        src: GUIDE,
        h2: 'How a change reaches your server',
        title: 'How a change reaches your server',
      },
      { slug: 'apps', src: GUIDE, h2: 'The apps', title: 'The apps' },
      { slug: 'learning', src: GUIDE, h2: 'Learning with GFV', title: 'Learning with GFV' },
      { slug: 'recipes-and-jobs', src: GUIDE, h2: 'Recipes and jobs', title: 'Recipes and jobs' },
      {
        slug: 'websites-and-network',
        src: GUIDE,
        h2: 'Websites, projects and the network',
        title: 'Websites, projects and the network',
      },
      {
        slug: 'firewall',
        src: GUIDE,
        h2: 'Firewall and lockout protection',
        title: 'Firewall and lockout protection',
      },
      {
        slug: 'security-and-backups',
        src: GUIDE,
        h2: 'Security checkup and backups',
        title: 'Security checkup and backups',
      },
      {
        slug: 'app-store-and-databases',
        src: GUIDE,
        h2: 'App Store and databases',
        title: 'App Store and databases',
      },
      { slug: 'assistant', src: GUIDE, h2: 'The assistant', title: 'The assistant' },
      { slug: 'phone', src: GUIDE, h2: 'Using GFV on a phone', title: 'Using GFV on a phone' },
    ],
  },
  {
    group: 'Run it anywhere',
    items: [
      { slug: 'hosted-mode', file: 'docs/HOSTED.md', title: 'Hosted mode (nginx, HTTPS, 2FA)' },
      {
        slug: 'for-several-people',
        src: GUIDE,
        h2: 'Running GFV for several people',
        title: 'Running it for several people',
      },
    ],
  },
  {
    group: 'Reference',
    items: [
      { slug: 'your-data', src: GUIDE, h2: 'Your data', title: 'Your data' },
      { slug: 'troubleshooting', src: GUIDE, h2: 'Troubleshooting', title: 'Troubleshooting' },
      { slug: 'known-limits', src: GUIDE, h2: 'Known limits', title: 'Known limits' },
      { slug: 'manual-testing', file: 'docs/MANUAL_TESTING.md', title: 'Manual test plan' },
    ],
  },
  {
    group: 'Project',
    items: [
      { slug: 'how-it-works', file: 'docs/HOW_IT_WORKS.md', title: 'How it works (architecture)' },
      { slug: 'design-system', file: 'docs/DESIGN_SYSTEM.md', title: 'Design system' },
      { slug: 'roadmap', file: 'docs/ROADMAP.md', title: 'Roadmap' },
      { slug: 'changelog', file: 'CHANGELOG.md', title: 'Changelog' },
      { slug: 'security', file: 'SECURITY.md', title: 'Security policy' },
      { slug: 'contributing', file: 'CONTRIBUTING.md', title: 'Contributing' },
      { slug: 'commercial-license', file: 'COMMERCIAL-LICENSE.md', title: 'Commercial license' },
      { slug: 'code-of-conduct', file: 'CODE_OF_CONDUCT.md', title: 'Code of conduct' },
    ],
  },
];

const md = new Marked({ gfm: true });
const pages = [];
const bySource = new Map(); // "docs/HOSTED.md" -> page ; "docs/USER_GUIDE.md#slug" -> page
const lexCache = new Map();
const lex = (file) => {
  if (!lexCache.has(file)) lexCache.set(file, md.lexer(read(file)));
  return lexCache.get(file);
};

/** Splits the user guide into one token list per `##` section. */
function guideSections() {
  const tokens = lex(GUIDE);
  const sections = new Map();
  let current = null;
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth === 2) {
      current = { title: t.text, tokens: [] };
      sections.set(t.text, current);
    } else if (current) current.tokens.push(t);
  }
  return sections;
}

function buildPageList() {
  const sections = guideSections();
  const guideH2ids = slugger();
  for (const group of NAV) {
    for (const item of group.items) {
      const route = `/docs/${item.slug}/`;
      let tokens;
      let title = item.title;
      let h1;
      if (item.h2) {
        const sec = sections.get(item.h2);
        if (!sec) throw new Error(`Section "${item.h2}" not found in ${GUIDE}`);
        tokens = sec.tokens;
        h1 = item.title;
        bySource.set(`${GUIDE}#${guideH2ids(item.h2)}`, { route, top: true });
      } else {
        const all = lex(item.file);
        const first = all.find((t) => t.type === 'heading' && t.depth === 1);
        tokens = first ? all.filter((t) => t !== first) : all;
        h1 = first ? first.text : item.title;
        bySource.set(item.file, { route, top: true });
      }
      const page = { ...item, group: group.group, route, tokens, h1, title };
      page.source = item.h2 ? GUIDE : item.file;
      // Ids of the headings inside this page (the renderer recomputes the same ids in the same order).
      const slug = slugger();
      page.headings = [];
      for (const t of tokens) {
        if (t.type === 'heading') {
          const id = slug(t.text);
          if (t.depth === 2 || t.depth === 3)
            page.headings.push({ depth: t.depth, text: plain(t.text), id });
          bySource.set(`${page.source}#${id}`, { route, id });
        }
      }
      // The description is the first paragraph, or (for pages that start with a list) the first few list items.
      const firstPara = tokens.find((t) => t.type === 'paragraph');
      const firstList = tokens.find((t) => t.type === 'list');
      const fromList = firstList?.items
        ?.slice(0, 3)
        .map((i) => plain(i.text))
        .join(' ');
      page.description = truncate(plain(firstPara?.text ?? fromList ?? LANDING_DESC), 158);
      page.lastmod = gitDate(page.source);
      pages.push(page);
    }
  }
}

/** Where a Markdown link written for GitHub should point on the website. */
function resolveHref(href, srcFile) {
  if (/^(https?:|mailto:|tel:)/i.test(href)) return { href, external: true };
  const [pathPart, frag] = href.split('#');
  const file = pathPart ? posix.normalize(posix.join(posix.dirname(srcFile), pathPart)) : srcFile;
  const key = frag ? `${file}#${frag}` : file;
  const hit = bySource.get(key) ?? (frag ? bySource.get(file) : undefined);
  if (hit) {
    // A heading of a split guide page maps to its page; a top-level section needs no fragment.
    const id = bySource.get(key)?.id;
    return { href: url(hit.route) + (id ? `#${id}` : ''), external: false };
  }
  if (!pathPart) return { href: `#${frag}`, external: false };
  const isDir = /\/$/.test(pathPart) || !/\.[a-z0-9]+$/i.test(file);
  return {
    href: `${GITHUB}/${isDir ? 'tree' : 'blob'}/main/${file}${frag ? `#${frag}` : ''}`,
    external: true,
  };
}

const copiedImages = new Set();
function docImage(href, srcFile) {
  if (/^https?:/i.test(href)) return href;
  const file = posix.normalize(posix.join(posix.dirname(srcFile), href));
  const from = join(ROOT, file);
  if (!existsSync(from)) return href;
  const to = `assets/docs/${file.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
  if (!copiedImages.has(file)) {
    mkdirSync(dirname(join(OUT, to)), { recursive: true });
    cpSync(from, join(OUT, to));
    copiedImages.add(file);
  }
  return url(`/${to}`);
}

function renderPage(page) {
  const slug = slugger();
  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const raw = tokens.map((t) => t.raw ?? t.text ?? '').join('');
      const id = slug(raw);
      const anchor =
        depth >= 2 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : '';
      return `<h${depth} id="${id}">${text}${anchor}</h${depth}>\n`;
    },
    code({ text, lang }) {
      const label = lang ? `<span class="lang">${esc(lang.split(/\s/)[0])}</span>` : '';
      const cls = lang ? ` class="language-${esc(lang.split(/\s/)[0])}"` : '';
      return `<div class="codeblock">${label}<button class="copy-btn" type="button" aria-label="Copy code">${icon('copy')}<span class="label">Copy</span></button><pre><code${cls}>${esc(text)}</code></pre></div>\n`;
    },
    link({ href, title, tokens }) {
      const r = resolveHref(href, page.source);
      const t = title ? ` title="${esc(title)}"` : '';
      const ext = r.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(r.href)}"${t}${ext}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, title, text }) {
      const t = title ? ` title="${esc(title)}"` : '';
      return `<img src="${esc(docImage(href, page.source))}" alt="${esc(text)}"${t} loading="lazy" decoding="async">`;
    },
    table(token) {
      const header = token.header
        .map(
          (c) =>
            `<th${c.align ? ` align="${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`,
        )
        .join('');
      const rows = token.rows
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td${c.align ? ` align="${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`,
        )
        .join('');
      // Some tables in the docs have an empty header row (they are written as two-column lists): skip it.
      const head = token.header.every((c) => !c.text.trim())
        ? ''
        : `<thead><tr>${header}</tr></thead>`;
      return `<div class="table-wrap"><table>${head}<tbody>${rows}</tbody></table></div>\n`;
    },
  };
  const m = new Marked({ gfm: true, renderer });
  return m.parser(page.tokens);
}

// ---- page chrome ----------------------------------------------------------------------------------------------------
const themeScript = `try{var t=localStorage.getItem('gfv-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

function head({ title, description, path, type = 'website', jsonld = [], noindex = false }) {
  const canonical = abs(path);
  const image = abs('/assets/img/og.png');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#090c1b" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fbfbfe" media="(prefers-color-scheme: light)">
<meta name="gfv-base" content="${esc(BASE)}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="${NAME}: ${esc(TAGLINE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="${url('/assets/logo.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${url('/assets/img/apple-touch-icon.png')}">
<link rel="preload" href="${url('/assets/fonts/inter-latin-wght-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('/assets/site.css')}?v=${hash('site.css')}">
<script>${themeScript}</script>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
`;
}

function header(active) {
  const link = (key, href, label, ext = false) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  return `<header class="site-header">
<div class="container nav">
  <a class="brand" href="${url('/')}"><img src="${url('/assets/logo.svg')}" alt="" width="28" height="28">GFV</a>
  <nav class="nav-links" aria-label="Main">
    ${link('docs', url('/docs/'), 'Docs')}
    ${link('install', url('/docs/install/'), 'Install')}
    ${link('hosted', url('/docs/hosted-mode/'), 'Hosted mode')}
    ${link('roadmap', url('/docs/roadmap/'), 'Roadmap')}
    ${link('changelog', url('/docs/changelog/'), 'Changelog')}
    <a href="${GITHUB}" target="_blank" rel="noopener noreferrer">GitHub</a>
  </nav>
  <span class="nav-spacer"></span>
  <button class="search-btn" type="button" data-search-open aria-label="Search the documentation">${icon('search')}<span>Search docs</span><kbd>/</kbd></button>
  <button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle light and dark theme">
    <span class="theme-dark-icon">${icon('moon')}</span><span class="theme-light-icon">${icon('sun')}</span>
  </button>
  <button class="icon-btn menu-btn" id="menu-toggle" type="button" aria-label="Menu" aria-expanded="false">${icon('menu')}</button>
</div>
</header>
`;
}

function searchDialog() {
  return `<dialog class="search-dialog" id="search-dialog" aria-label="Search the documentation">
  <input class="search-input" id="search-input" type="search" placeholder="Search the documentation…" autocomplete="off" aria-label="Search">
  <ul class="search-results" id="search-results"></ul>
</dialog>
`;
}

function footer() {
  return `<footer class="site-footer">
<div class="container">
  <div class="foot">
    <div>
      <a class="brand" href="${url('/')}"><img src="${url('/assets/logo.svg')}" alt="" width="28" height="28">GFV</a>
      <p>${TAGLINE}. Free software under the AGPL-3.0, with a commercial license available.</p>
    </div>
    <div><h5>Product</h5><ul>
      <li><a href="${url('/docs/install/')}">Install</a></li>
      <li><a href="${url('/docs/apps/')}">The apps</a></li>
      <li><a href="${url('/docs/firewall/')}">Lockout protection</a></li>
      <li><a href="${url('/docs/hosted-mode/')}">Hosted mode</a></li>
    </ul></div>
    <div><h5>Learn</h5><ul>
      <li><a href="${url('/docs/')}">Documentation</a></li>
      <li><a href="${url('/docs/how-it-works/')}">How it works</a></li>
      <li><a href="${url('/docs/troubleshooting/')}">Troubleshooting</a></li>
      <li><a href="${url('/docs/manual-testing/')}">Manual test plan</a></li>
    </ul></div>
    <div><h5>Project</h5><ul>
      <li><a href="${GITHUB}" target="_blank" rel="noopener noreferrer">GitHub</a></li>
      <li><a href="${NPM}" target="_blank" rel="noopener noreferrer">npm</a></li>
      <li><a href="${url('/docs/changelog/')}">Changelog</a></li>
      <li><a href="${url('/docs/security/')}">Security</a></li>
      <li><a href="${url('/docs/commercial-license/')}">Commercial license</a></li>
    </ul></div>
  </div>
  <div class="legal">
    <span>GFV v${VERSION}. No telemetry, no tracking, no cookies on this site.</span>
    <span>Not affiliated with any hosting provider.</span>
  </div>
</div>
</footer>
<script src="${url('/assets/site.js')}?v=${hash('site.js')}" defer></script>
</body>
</html>
`;
}

// ---- landing page ---------------------------------------------------------------------------------------------------
const APPS = [
  [
    'Terminal',
    'terminal',
    ['#4a4a4f', '#141416'],
    'A real shell, with a Safety Net on risky lines.',
  ],
  ['Files', 'folder-open', ['#5ac8fa', '#0a6fe0'], 'Browse, edit and copy files between servers.'],
  [
    'Monitor',
    'activity',
    ['#4cd97b', '#12994a'],
    'Live CPU, memory, network, disks and processes.',
  ],
  [
    'Services',
    'settings-2',
    ['#a1a1a8', '#5a5a60'],
    'Start, stop and read the logs of systemd services.',
  ],
  ['Docker', 'container', ['#3ec6e8', '#0b7fc4'], 'Containers and images, with logs.'],
  ['Dev Hub', 'hammer', ['#ffb340', '#f26a00'], 'One-click Node, Python, Docker, Postgres, nginx.'],
  [
    'Snapshots',
    'history',
    ['#c77dff', '#7d3fb0'],
    'A timeline of file backups with diffs and restore.',
  ],
  [
    'Recipes',
    'workflow',
    ['#ff7a98', '#d02f63'],
    'Record, export as a script, replay on many servers.',
  ],
  ['Network', 'network', ['#38bdf8', '#2563eb'], 'Ports, nginx sites and HTTPS in a few clicks.'],
  [
    'Projects',
    'folder-git-2',
    ['#fb923c', '#dc2626'],
    'Deploy from git, with env vars and a service.',
  ],
  ['Firewall', 'shield-alert', ['#fb7185', '#be123c'], 'ufw with a timer that undoes lockouts.'],
  ['Security', 'shield-check', ['#fbbf24', '#b45309'], 'A checkup with one-click, safe fixes.'],
  ['Backups', 'archive', ['#a78bfa', '#6d28d9'], 'Scheduled backups using real systemd timers.'],
  ['App Store', 'store', ['#f472b6', '#be185d'], 'Docker apps with generated passwords.'],
  ['Database', 'database', ['#60a5fa', '#1d4ed8'], 'Browse and query PostgreSQL over SSH.'],
  ['Assistant', 'bot', ['#a78bfa', '#7c3aed'], 'Optional help. You see what is sent first.'],
];
const FAQ = [
  [
    'Is GFV free?',
    'Yes. GFV is free software under the GNU AGPL-3.0, so you can run, read and change it. If you want to use it in a way the AGPL does not fit, for example inside a closed-source product, a commercial license is available. Versions 0.1.0 and 0.1.1 were released earlier under the MIT license.',
  ],
  [
    'Does GFV install anything on my servers?',
    'No. GFV runs on your computer and connects over SSH. There is no agent. The only things it leaves on a server are files you can see and delete: backups of files it changed, undo points for risky changes, and app passwords, all under ~/.gfv in your home folder.',
  ],
  [
    'Which servers does it work with?',
    'Ubuntu and Debian are the main targets. Fedora works for the Dev Hub and several other features. Alpine, Arch and firewalld are not supported yet. It has been tested on real cloud servers and on Docker test servers, and more reports from other setups are welcome.',
  ],
  [
    'Is it safe to point at a production server?',
    'GFV is young. Every change is previewed and risky ones need a confirmation, files are backed up before they are overwritten, and changes that could lock you out are protected by a timer on the server. Even so, the terminal Safety Net is a seatbelt rather than a security boundary, and hosted mode has not had an outside security review. Try it on a throwaway server first.',
  ],
  [
    'What happens to my SSH keys and passwords?',
    'They are encrypted on your computer with AES-256-GCM, using a key derived from your master password with scrypt. The master password is never stored and cannot be recovered. Nothing is sent anywhere, and there is no telemetry.',
  ],
  [
    'Can I use it from my phone, or from anywhere?',
    'Yes, in hosted mode: run GFV on a VPS behind nginx and HTTPS, and sign in with an account and two-factor authentication. There is a phone layout and GFV can be installed as an app. The documentation has a step-by-step guide, including how to use a free domain.',
  ],
  [
    'How is it different from a hosting control panel?',
    'A control panel hides what it does. GFV shows the exact shell commands for every action, explains them in plain English, and lets you export what you did as a script. The aim is that you get a GUI and still learn what happens underneath.',
  ],
];

function landing() {
  const lockSteps = [
    ['Save', 'The current rules are copied aside on the server.'],
    ['Arm a timer', 'A detached timer on the server will restore them.'],
    ['Change', 'The rule is applied, and GFV opens a brand new connection.'],
    [
      'Confirm or undo',
      'Only if it connects does it cancel the timer. If not, the server undoes it.',
    ],
  ];
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: NAME,
      alternateName: 'gui-for-vps',
      description: LANDING_DESC,
      url: abs('/'),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Linux, macOS, Windows (Node.js 22 or newer)',
      softwareVersion: VERSION,
      license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      downloadUrl: NPM,
      codeRepository: GITHUB,
      image: abs('/assets/img/og.png'),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
  const installCmd = 'npx gui-for-vps';
  return (
    head({ title: LANDING_TITLE, description: LANDING_DESC, path: '/', jsonld }) +
    header('') +
    `<main id="main">
<section class="hero">
  <div class="container">
    <span class="pill"><span class="dot"></span>Free software · AGPL-3.0 · Runs locally</span>
    <h1 class="hero-title">A desktop in your browser for the <span class="grad-text">Linux servers</span> you run</h1>
    <p class="hero-sub">Windows, a terminal and a file manager for your VPS, over SSH. Every change shows the exact command first, explained in plain English. Nothing is installed on your servers.</p>
    <div class="install" role="group" aria-label="Install command">
      <span class="prompt" aria-hidden="true">$</span><code>${installCmd}</code>
      <button class="copy-btn" type="button" data-copy="${installCmd}" aria-label="Copy install command">${icon('copy')}<span class="label">Copy</span></button>
    </div>
    <div class="hero-actions">
      <a class="btn primary" href="${url('/docs/install/')}">Get started ${icon('arrow-right')}</a>
      <a class="btn" href="${GITHUB}" target="_blank" rel="noopener noreferrer">${GITHUB_MARK} Star on GitHub</a>
    </div>
    <div class="hero-meta">
      <span>${icon('lock')} Credentials encrypted on your machine</span>
      <span>${icon('eye')} No telemetry</span>
      <span>${icon('server')} Ubuntu, Debian and Fedora</span>
    </div>
    <div class="hero-shot reveal">
      <div class="frame">
        <div class="frame-bar"><i></i><i></i><i></i></div>
        <img src="${url('/assets/img/desktop.webp')}" width="1320" height="800" alt="The GFV desktop: a Monitor, a file manager and a terminal open side by side on one server" fetchpriority="high" decoding="async">
      </div>
    </div>
  </div>
</section>

<section class="block" id="ideas">
  <div class="container">
    <div class="center">
      <div class="eyebrow">Three ideas</div>
      <h2 class="section-title">A GUI that does not hide the shell</h2>
      <p class="section-lead">Most server tools make you choose between memorising commands and trusting a panel. GFV gives you the buttons and keeps the commands in plain sight.</p>
    </div>
    <div class="cards">
      <article class="card reveal"><div class="ico">${icon('graduation-cap')}</div><h3>It teaches</h3><p>Every action shows the real commands and a short explanation. A journal keeps every command it ran, and "Try it yourself" types one into a terminal without running it.</p></article>
      <article class="card reveal"><div class="ico">${icon('shield-check')}</div><h3>It protects</h3><p>Risky actions wait for your confirmation, with the reason. Files are backed up before they change, and changes that could lock you out are guarded by a timer on the server.</p></article>
      <article class="card reveal"><div class="ico">${icon('workflow')}</div><h3>It remembers</h3><p>Press Record, do some work, press Stop, and export it as a bash script, an Ansible playbook, a Dockerfile or a Compose file. Replay it on other servers.</p></article>
    </div>
  </div>
</section>

<section class="block alt" id="features">
  <div class="container">
    <div class="feature reveal">
      <div class="feature-copy">
        <div class="eyebrow">Preview before you run</div>
        <h3>See exactly what will happen on your server</h3>
        <p>Click a button and GFV opens a review: what it does in plain English, the exact commands, and the risk. Nothing runs until you confirm, and the server checks that too, so a bug in the interface cannot skip it.</p>
        <ul class="checks">
          <li>${icon('check')}<span>Real commands, never hidden behind a button</span></li>
          <li>${icon('check')}<span>Safe, caution and danger levels with the reason</span></li>
          <li>${icon('check')}<span>Secrets never appear in commands, history or logs</span></li>
        </ul>
      </div>
      <div class="frame"><div class="frame-bar"><i></i><i></i><i></i></div><img src="${url('/assets/img/preview.webp')}" width="1100" height="680" loading="lazy" decoding="async" alt="The review window for installing Git: what it does, the exact commands, the risk and a confirmation checkbox"></div>
    </div>

    <div class="feature flip reveal" id="lockout">
      <div class="feature-copy">
        <div class="eyebrow">Lockout protection</div>
        <h3>Change the firewall without losing your server</h3>
        <p>A firewall rule can cut the very connection GFV is using, and then nothing in the browser can fix it. So the safety net lives on the server itself, and it works even when GFV cannot reach it.</p>
        <ul class="checks">
          <li>${icon('check')}<span>Proven against a real firewall, by genuinely locking GFV out</span></li>
          <li>${icon('check')}<span>An undo timeline for every change, and undo can be undone</span></li>
          <li>${icon('check')}<span>The same protection for SSH hardening</span></li>
        </ul>
      </div>
      <div class="feature-shot pair">
        <div class="frame"><div class="frame-bar"><i></i><i></i><i></i></div><img src="${url('/assets/img/firewall.webp')}" width="1320" height="800" loading="lazy" decoding="async" alt="The Firewall app listing rules in plain language with an undo timeline"></div>
      </div>
    </div>
    <div class="steps-flow reveal" aria-label="How lockout protection works">
      ${lockSteps.map(([t, d], i) => `<div class="step-node"><div class="step-num">${i + 1}</div><h4>${t}</h4><p>${d}</p></div>`).join('')}
    </div>

    <div class="feature reveal">
      <div class="feature-copy">
        <div class="eyebrow">Security checkup</div>
        <h3>Find what is wrong, fix it in one click</h3>
        <p>GFV reads a handful of settings and tells you what to look at: password logins, root over SSH, missing firewall, pending updates, fail2ban and open ports. Each finding explains why it matters and offers a safe fix, through the same preview.</p>
      </div>
      <div class="frame"><div class="frame-bar"><i></i><i></i><i></i></div><img src="${url('/assets/img/security-checkup.webp')}" width="1320" height="800" loading="lazy" decoding="async" alt="The Security checkup app listing findings with one-click fixes"></div>
    </div>

    <div class="feature flip reveal">
      <div class="feature-copy">
        <div class="eyebrow">Apps and mobile</div>
        <h3>Install apps, and use it from your phone</h3>
        <p>The App Store installs well-known Docker apps with generated passwords that never touch a command line. A phone layout gives you a launcher, a terminal with the keys a phone keyboard lacks, and an installable app.</p>
      </div>
      <div class="feature-shot pair">
        <div class="frame"><div class="frame-bar"><i></i><i></i><i></i></div><img src="${url('/assets/img/app-store.webp')}" width="1320" height="800" loading="lazy" decoding="async" alt="The App Store with one-click Docker apps"></div>
        <div class="frame phone-shot"><img src="${url('/assets/img/phone.webp')}" width="390" height="844" loading="lazy" decoding="async" alt="GFV on a phone: a launcher grid with one full-screen app at a time"></div>
      </div>
    </div>
  </div>
</section>

<section class="block" id="apps">
  <div class="container">
    <div class="center">
      <div class="eyebrow">Everything in one place</div>
      <h2 class="section-title">Sixteen apps, one desktop</h2>
      <p class="section-lead">Each app is built on the same Command Runner, which is what makes the previews, the confirmations and the recipes possible.</p>
    </div>
    <div class="apps">
      ${APPS.map(([n, i, [a, b], d]) => `<div class="app reveal"><div class="ico" style="background:linear-gradient(145deg,${a},${b})">${icon(i)}</div><div><b>${n}</b><span>${d}</span></div></div>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="block alt" id="start">
  <div class="container">
    <div class="center">
      <div class="eyebrow">Start in a minute</div>
      <h2 class="section-title">Three steps, no agent to install</h2>
    </div>
    <div class="cards">
      <article class="card reveal"><div class="ico">${icon('package')}</div><h3>1. Run it</h3><p>You need Node.js 22 or newer on your computer. Run <code>npx gui-for-vps</code> and open the address it prints.</p></article>
      <article class="card reveal"><div class="ico">${icon('key-round')}</div><h3>2. Add a server</h3><p>Choose a master password, then add a server with its address and SSH key. Check the host key fingerprint and trust it.</p></article>
      <article class="card reveal"><div class="ico">${icon('sparkles')}</div><h3>3. Work</h3><p>Open a terminal, browse files, watch the monitor, install tools. Read the commands as you go and learn what they do.</p></article>
    </div>
    <p class="center" style="margin-top:28px"><a class="btn" href="${url('/docs/install/')}">Read the install guide ${icon('arrow-right')}</a></p>
  </div>
</section>

<section class="block" id="trust">
  <div class="container">
    <div class="center">
      <div class="eyebrow">Built to be trusted</div>
      <h2 class="section-title">Local first, and honest about its limits</h2>
      <p class="section-lead">GFV holds the keys to your servers, so it is built to keep them on your computer and to say plainly what has and has not been proven.</p>
    </div>
    <div class="principles">
      <div class="principle reveal"><h4>${icon('lock')} Your keys stay with you</h4><p>GFV listens on 127.0.0.1 only. Credentials are encrypted with AES-256-GCM and a key derived from your master password with scrypt. Host keys are checked, and a changed key is never accepted silently.</p></div>
      <div class="principle reveal"><h4>${icon('eye')} Nothing leaves without a preview</h4><p>There is no telemetry. The optional assistant is off by default, shows you the exact text it would send with secrets removed, and only sends it when you press Send.</p></div>
      <div class="principle reveal"><h4>${icon('globe')} Run it anywhere</h4><p>In hosted mode GFV runs on your VPS behind nginx and HTTPS, with accounts, two-factor authentication, roles, per-server access and an audit log. <a href="${url('/docs/hosted-mode/')}">Read the guide</a>.</p></div>
      <div class="principle reveal"><h4>${icon('undo-2')} Mistakes are recoverable</h4><p>Files are snapshotted before they change, restores can be undone, and a recipe turns what you did into a script you can read and run again.</p></div>
    </div>
    <div class="status">
      <div class="status-col ok reveal"><h4>${icon('check')} Tested against real systems</h4><ul>
        <li>A real firewall locking itself out and being restored by the server</li>
        <li>Real systemd timers, Docker and PostgreSQL through an SSH tunnel</li>
        <li>Package installs on Ubuntu and Fedora, and two real cloud VPSes</li>
        <li>Hosted mode behind nginx and Let's Encrypt on one real server</li>
      </ul></div>
      <div class="status-col todo reveal"><h4>${icon('eye')} Not proven yet</h4><ul>
        <li>The assistant against the real Anthropic API or a real Ollama server</li>
        <li>An outside security review of hosted mode</li>
        <li>A wide range of providers and distributions</li>
        <li>The terminal Safety Net is a seatbelt, not a security boundary</li>
      </ul></div>
    </div>
  </div>
</section>

<section class="block alt" id="faq">
  <div class="container">
    <div class="center">
      <div class="eyebrow">Questions</div>
      <h2 class="section-title">Frequently asked questions</h2>
    </div>
    <div class="faq">
      ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="block" id="get">
  <div class="container">
    <div class="cta reveal">
      <h2>Try it on a throwaway server first</h2>
      <p>It takes about a minute to start. The repository even includes disposable Docker servers to practise on.</p>
      <div class="install" role="group" aria-label="Install command"><span class="prompt" aria-hidden="true">$</span><code>${installCmd}</code><button class="copy-btn" type="button" data-copy="${installCmd}" aria-label="Copy install command">${icon('copy')}<span class="label">Copy</span></button></div>
      <div class="hero-actions"><a class="btn primary" href="${url('/docs/install/')}">Read the docs</a><a class="btn" href="${NPM}" target="_blank" rel="noopener noreferrer">View on npm</a></div>
    </div>
  </div>
</section>
</main>
` +
    searchDialog() +
    footer()
  );
}

// ---- docs pages -----------------------------------------------------------------------------------------------------
function sidebar(activeSlug) {
  return `<nav class="docs-nav" aria-label="Documentation">
${NAV.map(
  (g) =>
    `<h6>${g.group}</h6><ul>${g.items
      .map(
        (i) =>
          `<li><a href="${url(`/docs/${i.slug}/`)}"${i.slug === activeSlug ? ' aria-current="page"' : ''}>${esc(i.title)}</a></li>`,
      )
      .join('')}</ul>`,
).join('\n')}
</nav>`;
}

function docPage(page, index) {
  const body = renderPage(page);
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const toc = page.headings.length > 1 ? page.headings : [];
  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: NAME, item: abs('/') },
        { '@type': 'ListItem', position: 2, name: 'Docs', item: abs('/docs/') },
        { '@type': 'ListItem', position: 3, name: page.title, item: abs(page.route) },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: page.h1,
      description: page.description,
      url: abs(page.route),
      dateModified: page.lastmod,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: `${NAME} documentation`, url: abs('/docs/') },
    },
  ];
  return (
    head({
      title: `${page.title} · ${NAME} docs`,
      description: page.description,
      path: page.route,
      type: 'article',
      jsonld,
    }) +
    header(
      page.slug === 'install'
        ? 'install'
        : page.slug === 'hosted-mode'
          ? 'hosted'
          : page.slug === 'roadmap'
            ? 'roadmap'
            : page.slug === 'changelog'
              ? 'changelog'
              : 'docs',
    ) +
    `<div class="container docs${toc.length ? '' : ' no-toc'}">
  <aside>
    <button class="docs-toggle" id="docs-toggle" type="button" aria-expanded="false">${icon('book-open')} Documentation menu</button>
    ${sidebar(page.slug)}
  </aside>
  <main class="docs-main" id="main">
    <div class="crumbs"><a href="${url('/docs/')}">Docs</a><span aria-hidden="true">/</span><span>${esc(page.group)}</span></div>
    <article class="prose">
      <h1>${esc(page.h1.replace(/`/g, ''))}</h1>
      ${body}
    </article>
    <div class="docs-foot">
      <a class="edit-link" href="${GITHUB}/edit/main/${page.source}" target="_blank" rel="noopener noreferrer">${icon('file-code-2')} Edit this page on GitHub</a>
      <div class="pager">
        ${prev ? `<a class="prev" href="${url(prev.route)}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="next" href="${url(next.route)}"><small>Next</small>${esc(next.title)}</a>` : ''}
      </div>
    </div>
  </main>
  ${toc.length ? `<aside class="toc" aria-label="On this page">` : ''}${
    toc.length
      ? `<h6>On this page</h6><ul>${toc.map((h) => `<li><a class="lvl${h.depth}" href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ul>`
      : ''
  }${toc.length ? '</aside>' : ''}
</div>
` +
    searchDialog() +
    footer()
  );
}

function docsIndex() {
  const cards = [
    [
      'install',
      'package',
      'Install and run',
      'Start GFV with npx, or from the repository, and open it for the first time.',
    ],
    [
      'first-run',
      'key-round',
      'First run',
      'Choose a master password, add a server and trust its host key.',
    ],
    [
      'how-changes-work',
      'shield-check',
      'How a change reaches your server',
      'Preview, confirmation, snapshots and the Safety Net, explained.',
    ],
    [
      'apps',
      'layout-grid',
      'The apps',
      'What each app does: terminal, files, monitor, services and more.',
    ],
    [
      'firewall',
      'shield-alert',
      'Firewall and lockout protection',
      'Change ufw rules without ever cutting yourself off.',
    ],
    [
      'hosted-mode',
      'globe',
      'Run it on a server',
      'Hosted mode behind nginx and HTTPS, with a free domain and two-factor sign-in.',
    ],
    ['troubleshooting', 'life-buoy', 'Troubleshooting', 'Fixes for the most common problems.'],
    [
      'how-it-works',
      'workflow',
      'How it works',
      'The architecture, for people who want to read or change the code.',
    ],
  ];
  const body = `<div class="crumbs"><a href="${url('/')}">GFV</a><span aria-hidden="true">/</span><span>Docs</span></div>
    <article class="prose">
      <h1>Documentation</h1>
      <p>Everything you need to install GFV, use each app, run it on a server, and find your way around the code. New here? Start with <a href="${url('/docs/install/')}">Install and run</a>.</p>
      <div class="codeblock"><span class="lang">bash</span><button class="copy-btn" type="button" aria-label="Copy code">${icon('copy')}<span class="label">Copy</span></button><pre><code class="language-bash">npx gui-for-vps</code></pre></div>
      <div class="doc-cards">
        ${cards.map(([slug, ic, t, d]) => `<a class="doc-card" href="${url(`/docs/${slug}/`)}"><b>${icon(ic)} ${t}</b><span>${d}</span></a>`).join('\n        ')}
      </div>
      <h2 id="all-pages">All pages</h2>
      ${NAV.map((g) => `<h3>${g.group}</h3><ul>${g.items.map((i) => `<li><a href="${url(`/docs/${i.slug}/`)}">${esc(i.title)}</a></li>`).join('')}</ul>`).join('')}
    </article>`;
  return (
    head({
      title: `Documentation · ${NAME}`,
      description: `Install ${NAME}, learn each app, run it on a server with HTTPS and two-factor sign-in, and explore how it works.`,
      path: '/docs/',
    }) +
    header('docs') +
    `<div class="container docs no-toc">
  <aside>
    <button class="docs-toggle" id="docs-toggle" type="button" aria-expanded="false">${icon('book-open')} Documentation menu</button>
    ${sidebar('')}
  </aside>
  <main class="docs-main" id="main">${body}</main>
</div>
` +
    searchDialog() +
    footer()
  );
}

function notFound() {
  return (
    head({
      title: `Page not found · ${NAME}`,
      description: 'This page does not exist.',
      path: '/404.html',
      noindex: true,
    }) +
    header('') +
    `<main id="main" class="container" style="padding:120px 24px;text-align:center">
  <p class="eyebrow">404</p>
  <h1 class="section-title">That page does not exist</h1>
  <p class="section-lead" style="margin-inline:auto">It may have moved. Try the documentation, or go back to the home page.</p>
  <p style="margin-top:28px"><a class="btn primary" href="${url('/docs/')}">Open the docs</a> <a class="btn" href="${url('/')}">Home</a></p>
</main>
` +
    searchDialog() +
    footer()
  );
}

// ---- search index, sitemap, robots ----------------------------------------------------------------------------------
function searchIndex() {
  const out = [];
  for (const page of pages) {
    out.push({ h: page.title, p: page.group, u: page.route, x: plain(page.description) });
    // One entry per heading, with the first words of its section as searchable text.
    const toks = page.tokens;
    const slug = slugger();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'heading') continue;
      const id = slug(t.text);
      if (t.depth !== 2 && t.depth !== 3) continue;
      if (/^contents$/i.test(plain(t.text))) continue;
      let text = '';
      for (let j = i + 1; j < toks.length && toks[j].type !== 'heading' && text.length < 360; j++)
        text += ` ${plain(toks[j].raw ?? '')}`;
      out.push({
        h: plain(t.text),
        p: page.title,
        u: `${page.route}#${id}`,
        x: truncate(text.trim(), 360),
      });
    }
  }
  return out;
}
function sitemap() {
  const urls = [
    { loc: '/', lastmod: gitDate('README.md'), pri: '1.0' },
    { loc: '/docs/', lastmod: TODAY, pri: '0.9' },
    ...pages.map((p) => ({
      loc: p.route,
      lastmod: p.lastmod,
      pri: p.group === 'Project' ? '0.5' : '0.8',
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${abs(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>
`;
}

// ---- run ------------------------------------------------------------------------------------------------------------
await loadIcons([
  'terminal',
  'folder-open',
  'activity',
  'settings-2',
  'container',
  'hammer',
  'history',
  'workflow',
  'network',
  'folder-git-2',
  'shield-alert',
  'shield-check',
  'archive',
  'store',
  'database',
  'bot',
  'copy',
  'check',
  'search',
  'moon',
  'sun',
  'menu',
  'lock',
  'eye',
  'server',
  'graduation-cap',
  'arrow-right',
  'package',
  'key-round',
  'sparkles',
  'globe',
  'undo-2',
  'book-open',
  'file-code-2',
  'layout-grid',
  'life-buoy',
]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'assets'), join(OUT, 'assets'), { recursive: true });
cpSync(
  join(ROOT, 'web/public/icons/apple-touch-icon.png'),
  join(OUT, 'assets/img/apple-touch-icon.png'),
);

buildPageList();
write('index.html', landing());
write('docs/index.html', docsIndex());
pages.forEach((p, i) => write(`docs/${p.slug}/index.html`, docPage(p, i)));
write('404.html', notFound());
write('search-index.json', JSON.stringify(searchIndex()));
write('sitemap.xml', sitemap());
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
write('.nojekyll', '');
if (process.env.CNAME) write('CNAME', `${process.env.CNAME}\n`);

console.log(`Built ${pages.length + 3} pages into ${relative(ROOT, OUT)}`);
console.log(`  site url: ${SITE_URL || '(none)'}   base path: ${BASE || '(root)'}`);
