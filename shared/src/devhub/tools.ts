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

const UNSUPPORTED = (pretty = '$PRETTY_NAME') =>
  `echo "GFV can only install tools on Ubuntu, Debian, Fedora and RHEL-family servers for now (this server runs ${pretty})." >&2; exit 1`;

/** First command of every install: refuse politely on a distro family we do not know. */
export const DISTRO_GUARD =
  '. /etc/os-release && case "$ID $ID_LIKE" in *ubuntu*|*debian*) echo "Detected $PRETTY_NAME" ;; ' +
  `*) ${UNSUPPORTED()} ;; esac`;
export const DNF_GUARD =
  '. /etc/os-release && case "$ID $ID_LIKE" in *fedora*|*rhel*|*centos*) echo "Detected $PRETTY_NAME" ;; ' +
  `*) ${UNSUPPORTED()} ;; esac`;
const ANY_GUARD =
  '. /etc/os-release && case "$ID $ID_LIKE" in *ubuntu*|*debian*|*fedora*|*rhel*|*centos*) echo "Detected $PRETTY_NAME" ;; ' +
  `*) ${UNSUPPORTED()} ;; esac`;

/** apt without questions, waiting (up to 2 min) for another package manager to finish. */
export const apt = (ctx: ActionCtx, args: string) =>
  `${ctx.sudo}env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 ${args}`;
/**
 * `apt-get update` takes a different lock (the package lists) that DPkg::Lock::Timeout does NOT cover: while another
 * apt (unattended-upgrades, a second install) holds it, update fails at once with "Could not get lock". So retry for
 * about two minutes, telling the person why it is waiting.
 */
export const aptUpdate = (ctx: ActionCtx) =>
  `n=0; until ${apt(ctx, 'update')}; do n=$((n+1)); [ $n -ge 12 ] && exit 1; echo "The package system is busy; trying again in 10 seconds..." >&2; sleep 10; done`;
const dnf = (ctx: ActionCtx, args: string) => `${ctx.sudo}dnf -y -q ${args}`;

/** The package manager a command list should be written for. */
const pm = (ctx: ActionCtx) => ctx.pkg ?? 'apt';

/**
 * For exported scripts (`pkg: 'auto'`): ONE command that picks apt or dnf when it runs. The branches are the
 * very command lists the live server would run, so what you preview is what a script does.
 */
function either(aptCmds: string[], dnfCmds: string[] | null): string[] {
  const dnfBranch = dnfCmds
    ? `elif command -v dnf >/dev/null 2>&1; then ${dnfCmds.join(' && ')}; `
    : `elif command -v dnf >/dev/null 2>&1; then ${UNSUPPORTED('a dnf-based system')}; `;
  return [
    `if command -v apt-get >/dev/null 2>&1; then ${aptCmds.join(' && ')}; ${dnfBranch}` +
      `else ${UNSUPPORTED('this system')}; fi`,
  ];
}

interface PkgSpec {
  /** apt packages to install / remove. */
  apt: string;
  /** dnf packages; null = not available from the standard repositories (the install explains that). */
  dnf: string | null;
  /** Commands to run after a dnf install (initialise a database...). */
  dnfAfter?: string[];
  /** Commands to run after an apt install. Debian-family packages normally start their service themselves, but not
   * everywhere (containers and images with a policy-rc.d forbid it), so a tool whose service matters says so here. */
  aptAfter?: string[];
  /** Packages to remove with dnf (defaults to `dnf`). */
  dnfRemove?: string;
  aptRemove?: string;
  check: string;
}

function pkgInstall(ctx: ActionCtx, spec: PkgSpec): string[] {
  const aptCmds = [
    aptUpdate(ctx),
    apt(ctx, `install ${spec.apt}`),
    ...(spec.aptAfter?.map((c) => c.replace('$SUDO', ctx.sudo.trim())) ?? []),
  ];
  const dnfCmds = spec.dnf
    ? [
        dnf(ctx, `install ${spec.dnf}`),
        ...(spec.dnfAfter?.map((c) => c.replace('$SUDO', ctx.sudo.trim())) ?? []),
      ]
    : null;
  const check = spec.check;
  switch (pm(ctx)) {
    case 'dnf':
      return dnfCmds
        ? [DNF_GUARD, ...dnfCmds, check]
        : [
            DNF_GUARD,
            `echo "${spec.apt.split(' ')[0]} is not in the standard Fedora/RHEL repositories. Install it from the project's own repository." >&2; exit 1`,
          ];
    case 'auto':
      return [ANY_GUARD, ...either(aptCmds, dnfCmds), check];
    default:
      return [DISTRO_GUARD, ...aptCmds, check];
  }
}

function pkgRemove(ctx: ActionCtx, spec: PkgSpec): string[] {
  const aptCmds = [apt(ctx, `remove ${spec.aptRemove ?? spec.apt}`), apt(ctx, 'autoremove')];
  const dnfCmds = spec.dnf
    ? [dnf(ctx, `remove ${spec.dnfRemove ?? spec.dnf}`), dnf(ctx, 'autoremove')]
    : null;
  switch (pm(ctx)) {
    case 'dnf':
      return (
        dnfCmds ?? [
          'echo "Nothing to remove: this tool is not installed with dnf by GFV." >&2; exit 1',
        ]
      );
    case 'auto':
      return either(aptCmds, dnfCmds);
    default:
      return aptCmds;
  }
}

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
      ...(pm(ctx) === 'dnf'
        ? [DNF_GUARD, dnf(ctx, 'install curl ca-certificates tar gzip')]
        : pm(ctx) === 'auto'
          ? [
              ANY_GUARD,
              ...either(
                [aptUpdate(ctx), apt(ctx, 'install curl ca-certificates')],
                [dnf(ctx, 'install curl ca-certificates tar gzip')],
              ),
            ]
          : [DISTRO_GUARD, aptUpdate(ctx), apt(ctx, 'install curl ca-certificates')]),
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
      'Python 3 with pip (package installer) and venv (isolated environments) from the system repositories.',
    installExplain:
      'Updates the package list, then installs python3, pip and venv with the system package manager (apt, or dnf on Fedora/RHEL).',
    uninstallExplain:
      'Removes pip and venv. Python 3 itself is kept: the operating system depends on it.',
    install: (ctx) =>
      pkgInstall(ctx, {
        apt: 'python3 python3-pip python3-venv',
        dnf: 'python3 python3-pip',
        check: 'python3 --version && pip3 --version',
      }),
    uninstall: (ctx) =>
      pkgRemove(ctx, { apt: 'python3-pip python3-venv', dnf: 'python3-pip', check: '' }),
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
    install: (ctx) =>
      pkgInstall(ctx, {
        apt: 'docker.io',
        dnf: null,
        aptAfter: ['$SUDO systemctl enable --now docker'],
        check: `${ctx.sudo}docker --version`,
      }),
    uninstall: (ctx) => pkgRemove(ctx, { apt: 'docker.io', dnf: null, check: '' }),
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
    install: (ctx) =>
      pkgInstall(ctx, {
        apt: 'postgresql postgresql-contrib',
        dnf: 'postgresql-server postgresql-contrib',
        // Fedora/RHEL do not create the database cluster for you: initialise it (once, and a failure
        // stops the install instead of hiding until the service refuses to start), then start the service.
        dnfAfter: [
          '[ -s /var/lib/pgsql/data/PG_VERSION ] || $SUDO postgresql-setup --initdb',
          '$SUDO systemctl enable --now postgresql',
        ],
        check: 'psql --version',
      }),
    uninstall: (ctx) =>
      pkgRemove(ctx, {
        apt: 'postgresql postgresql-contrib',
        dnf: 'postgresql-server postgresql-contrib',
        check: '',
      }),
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
    install: (ctx) => pkgInstall(ctx, { apt: 'nginx', dnf: 'nginx', check: 'nginx -v 2>&1' }),
    uninstall: (ctx) =>
      pkgRemove(ctx, { apt: 'nginx', aptRemove: 'nginx nginx-common', dnf: 'nginx', check: '' }),
  },
  {
    id: 'git',
    name: 'Git',
    icon: '🔀',
    description: 'Git version control.',
    installExplain: 'Updates the package list, then installs git with apt.',
    uninstallExplain: 'Removes git. Your repositories are ordinary folders and are not touched.',
    install: (ctx) => pkgInstall(ctx, { apt: 'git', dnf: 'git', check: 'git --version' }),
    uninstall: (ctx) => pkgRemove(ctx, { apt: 'git', dnf: 'git', check: '' }),
  },
];

export const toolById = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);

/** Postgres only: remove the programs AND every database. */
export const purgePostgresCommands = (ctx: ActionCtx): string[] => {
  const aptCmds = [
    apt(ctx, 'purge postgresql postgresql-contrib postgresql-common'),
    apt(ctx, 'autoremove'),
    `${ctx.sudo}rm -rf /var/lib/postgresql /etc/postgresql`,
  ];
  const dnfCmds = [
    dnf(ctx, 'remove postgresql-server postgresql-contrib'),
    dnf(ctx, 'autoremove'),
    `${ctx.sudo}rm -rf /var/lib/pgsql`,
  ];
  return pm(ctx) === 'dnf' ? dnfCmds : pm(ctx) === 'auto' ? either(aptCmds, dnfCmds) : aptCmds;
};
