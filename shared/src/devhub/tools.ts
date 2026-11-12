import type { ActionCtx } from '../actions/define.js';

/** The Dev Hub catalog: what each one-click tool installs, and how to remove it. */

export const TOOL_IDS = ['node', 'python', 'docker', 'postgresql', 'nginx', 'git'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolDef {
  id: ToolId;
  name: string;
  icon: string;
  description: string;
  /** systemd unit to start/stop from the card, for tools that run as a service. */
  unit?: string;
  install(ctx: ActionCtx): string[];
  uninstall(ctx: ActionCtx): string[];
  /** Extra explanation shown with the install preview. */
  installExplain: string;
  uninstallExplain: string;
}

// Pinned: the installer is downloaded to a file and its SHA-256 checked before it runs.
export const NVM_VERSION = 'v0.40.3';
export const NVM_URL = `https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh`;
export const NVM_SHA256 = '2d8359a64a3cb07c02389ad88ceecd43f2fa469c06104f92f98df5b6f315275f';
export const NODE_MAJOR = 22;

/** First command of every install: refuse politely on anything that is not Ubuntu/Debian. */
export const DISTRO_GUARD =
  '. /etc/os-release && case "$ID $ID_LIKE" in *ubuntu*|*debian*) echo "Detected $PRETTY_NAME" ;; ' +
  '*) echo "GFV can only install tools on Ubuntu or Debian for now (this server runs $PRETTY_NAME)." >&2; exit 1 ;; esac';

/** apt without questions, waiting (up to 2 min) for another package manager to finish. */
const apt = (ctx: ActionCtx, args: string) =>
  `${ctx.sudo}env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 ${args}`;

const aptInstall = (ctx: ActionCtx, packages: string, check: string): string[] => [
  DISTRO_GUARD,
  apt(ctx, 'update'),
  apt(ctx, `install ${packages}`),
  check,
];

const aptRemove = (ctx: ActionCtx, packages: string): string[] => [
  apt(ctx, `remove ${packages}`),
  apt(ctx, 'autoremove'),
];

export const TOOLS: ToolDef[] = [
  {
    id: 'node',
    name: 'Node.js',
    icon: '🟢',
    description: `Node.js ${NODE_MAJOR} (LTS) through nvm, the Node version manager. Installed for your user only, no root needed for Node itself.`,
    installExplain:
      'Installs curl, downloads the nvm installer, checks that it is the exact file we expect (SHA-256), runs it, then uses nvm to install Node.js. Nothing is piped straight into a shell.',
    uninstallExplain:
      'Deletes the ~/.nvm folder, which holds nvm and every Node version installed with it. Lines nvm added to ~/.bashrc stay but are harmless.',
    install: (ctx) => [
      DISTRO_GUARD,
      apt(ctx, 'update'),
      apt(ctx, 'install curl ca-certificates'),
      `curl -fsSL -o /tmp/gfv-nvm-install.sh ${NVM_URL}`,
      `echo "${NVM_SHA256}  /tmp/gfv-nvm-install.sh" | sha256sum -c -`,
      'bash /tmp/gfv-nvm-install.sh',
      `bash -c '. "$HOME/.nvm/nvm.sh" && nvm install ${NODE_MAJOR} && node -v && npm -v'`,
    ],
    uninstall: () => ['rm -rf "$HOME/.nvm"'],
  },
  {
    id: 'python',
    name: 'Python 3',
    icon: '🐍',
    description:
      'Python 3 with pip (package installer) and venv (isolated environments) from the Ubuntu/Debian repositories.',
    installExplain:
      'Updates the package list, then installs python3, python3-pip and python3-venv with apt.',
    uninstallExplain:
      'Removes pip and venv. Python 3 itself is kept: the operating system depends on it.',
    install: (ctx) =>
      aptInstall(ctx, 'python3 python3-pip python3-venv', 'python3 --version && pip3 --version'),
    uninstall: (ctx) => aptRemove(ctx, 'python3-pip python3-venv'),
  },
  {
    id: 'docker',
    name: 'Docker',
    icon: '🐳',
    description:
      'Docker Engine from the Ubuntu/Debian repositories (the docker.io package). It is a little older than Docker’s own packages, but needs no extra download sources.',
    installExplain:
      'Installs docker.io with apt. GFV does not add your user to the docker group (that is the same as giving it root); use sudo docker or the Docker app.',
    uninstallExplain:
      'Removes Docker Engine. Your images, containers and volumes under /var/lib/docker are kept on disk.',
    unit: 'docker.service',
    install: (ctx) => aptInstall(ctx, 'docker.io', `${ctx.sudo}docker --version`),
    uninstall: (ctx) => aptRemove(ctx, 'docker.io'),
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    icon: '🐘',
    description: 'The PostgreSQL database server, plus extra modules (postgresql-contrib).',
    installExplain:
      'Installs postgresql and postgresql-contrib with apt. The server starts automatically and creates a "postgres" admin account.',
    uninstallExplain:
      'Removes the PostgreSQL programs. Your databases and configuration stay on disk, so installing again brings them back.',
    unit: 'postgresql.service',
    install: (ctx) => aptInstall(ctx, 'postgresql postgresql-contrib', 'psql --version'),
    uninstall: (ctx) => aptRemove(ctx, 'postgresql postgresql-contrib'),
  },
  {
    id: 'nginx',
    name: 'nginx',
    icon: '🌐',
    description: 'The nginx web server and reverse proxy.',
    installExplain:
      'Installs nginx with apt. It starts automatically and serves a welcome page on port 80.',
    uninstallExplain: 'Removes nginx. Your site configuration in /etc/nginx stays on disk.',
    unit: 'nginx.service',
    install: (ctx) => aptInstall(ctx, 'nginx', 'nginx -v 2>&1'),
    uninstall: (ctx) => aptRemove(ctx, 'nginx nginx-common'),
  },
  {
    id: 'git',
    name: 'Git',
    icon: '🔀',
    description: 'Git version control.',
    installExplain: 'Updates the package list, then installs git with apt.',
    uninstallExplain: 'Removes git. Your repositories are ordinary folders and are not touched.',
    install: (ctx) => aptInstall(ctx, 'git', 'git --version'),
    uninstall: (ctx) => aptRemove(ctx, 'git'),
  },
];

export const toolById = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);

/** Postgres only: remove the programs AND every database. */
export const purgePostgresCommands = (ctx: ActionCtx): string[] => [
  apt(ctx, 'purge postgresql postgresql-contrib postgresql-common'),
  apt(ctx, 'autoremove'),
  `${ctx.sudo}rm -rf /var/lib/postgresql /etc/postgresql`,
];
