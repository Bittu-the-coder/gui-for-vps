// Builds the publishable `gfv` package into dist-pkg/:
//   dist/cli.js   the server + shared code bundled into one file (dependencies stay external)
//   web/          the built web app
//   drizzle/      database migrations
//   package.json  generated: only the runtime dependencies
// Then `cd dist-pkg && pnpm pack` makes the tarball that `npx gfv` would download.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-pkg');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const rootPkg = read('package.json');
const serverPkg = read('server/package.json');

console.log('1/4 building the web app');
execFileSync('pnpm', ['--filter', '@gfv/web', 'build'], { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, 'dist'), { recursive: true });

// Runtime dependencies of the server, minus our own workspace package (it gets bundled).
const deps = Object.fromEntries(
  Object.entries(serverPkg.dependencies).filter(([k]) => !k.startsWith('@gfv/')),
);

console.log('2/4 bundling the server');
await build({
  entryPoints: [resolve(root, 'server/src/cli.ts')],
  outfile: resolve(out, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...Object.keys(deps), 'drizzle-orm/*'],
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('3/4 copying the web app and migrations');
cpSync(resolve(root, 'web/dist'), resolve(out, 'web'), { recursive: true });
cpSync(resolve(root, 'server/drizzle'), resolve(out, 'drizzle'), { recursive: true });
if (existsSync(resolve(root, 'README.md')))
  cpSync(resolve(root, 'README.md'), resolve(out, 'README.md'));

console.log('4/4 writing package.json');
writeFileSync(
  resolve(out, 'package.json'),
  JSON.stringify(
    {
      name: 'gfv',
      version: rootPkg.version,
      description:
        'A desktop in your browser for your VPS servers: teaches you, protects you, and clones your setup.',
      keywords: ['vps', 'ssh', 'server', 'gui', 'terminal'],
      type: 'module',
      bin: { gfv: 'dist/cli.js' },
      files: ['dist', 'web', 'drizzle', 'README.md'],
      engines: { node: '>=22' },
      // Not decided yet: pick a license before publishing.
      license: 'UNLICENSED',
      dependencies: deps,
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nDone: ${out}\nTry it:  node dist-pkg/dist/cli.js --help`);
