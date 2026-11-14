import { z } from 'zod';
import { shellQuote } from '../shell.js';
import {
  branchName,
  envKey,
  projectName,
  PROJECTS_DIR,
  renderUnit,
  repoUrl,
  unitName,
  requiredUserCommand,
  userCommand,
} from '../projects/project.js';
import { defineAction, type ActionCtx } from './define.js';

/** The project folder as a shell word. `name` is validated (lower-case letters, digits, hyphens), so it is safe unquoted. */
const dir = (name: string) => `"$HOME/${PROJECTS_DIR}/${name}"`;
const unitPath = (name: string) => `/etc/systemd/system/${unitName(name)}`;
const NEED_GIT =
  'command -v git >/dev/null 2>&1 || { echo "git is not installed: install it from the Dev Hub first." >&2; exit 1; }';
/** Git must never wait for a password on a terminal that does not exist. */
const git = 'env GIT_TERMINAL_PROMPT=0 git';
const restartIfInstalled = (name: string, ctx: ActionCtx) =>
  `if [ -e ${unitPath(name)} ]; then ${ctx.sudo}systemctl restart ${unitName(name)}; fi`;

export const LIST_PROJECTS_COMMAND =
  `d="$HOME/${PROJECTS_DIR}"; for p in "$d"/*/; do [ -d "$p" ] || continue; n=$(basename "$p"); ` +
  'echo "==PROJECT:$n"; [ -f "$p/.gfv-project.json" ] && echo "META:$(cat "$p/.gfv-project.json")"; ' +
  'echo "HEAD:$(git -C "$p" rev-parse --short HEAD 2>/dev/null)"; ' +
  'echo "ACTIVE:$(systemctl is-active "gfv-$n.service" 2>/dev/null | head -n 1)"; ' +
  'if [ -f "$p/.env" ]; then echo ENV:yes; else echo ENV:no; fi; ' +
  'if [ -e "/etc/systemd/system/gfv-$n.service" ]; then echo UNIT:yes; else echo UNIT:no; fi; ' +
  'echo "BEHIND:$(git -C "$p" rev-list --count HEAD..@{u} 2>/dev/null)"; done';

export const listProjects = defineAction({
  id: 'projects.list',
  title: 'List projects',
  explain:
    'Looks in ~/gfv-projects: for each project it reads its settings file, the current git commit, whether its service is running, whether it has an .env file, and how many commits it is behind the remote (as of the last fetch).',
  params: z.object({}),
  commands: () => [LIST_PROJECTS_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

const deployParams = z.object({
  name: projectName,
  repo: repoUrl,
  branch: branchName.default('main'),
  /** Runs inside the project folder after the code is updated (install dependencies, build...). */
  build: userCommand.optional(),
  /** Remembered for the service. */
  start: userCommand.optional(),
});

export const deployProject = defineAction({
  id: 'projects.deploy',
  title: 'Deploy a project from git',
  explain:
    'Gets the code into ~/gfv-projects/<name>: the first time it clones the repository, afterwards it fetches and moves the folder to the branch’s latest commit (git reset --hard: local edits inside that folder are discarded). Then it runs your build command there, saves the project’s settings, and restarts its service if one is installed.',
  params: deployParams,
  commands: ({ name, repo, branch, build, start }, ctx) => [
    NEED_GIT,
    `mkdir -p "$HOME/${PROJECTS_DIR}"`,
    `if [ -d ${dir(name)}/.git ]; then ${git} -C ${dir(name)} fetch --prune origin && ${git} -C ${dir(name)} checkout -q ${shellQuote(branch)} && ${git} -C ${dir(name)} reset --hard ${shellQuote(`origin/${branch}`)}; ` +
      `else ${git} clone --branch ${shellQuote(branch)} -- ${shellQuote(repo)} ${dir(name)}; fi`,
    ...(build ? [`cd ${dir(name)} && bash -c ${shellQuote(build)}`] : []),
    `printf '%s\\n' ${shellQuote(JSON.stringify({ name, repo, branch, ...(build ? { build } : {}), ...(start ? { start } : {}) }))} > ${dir(name)}/.gfv-project.json`,
    restartIfInstalled(name, ctx),
  ],
  risk: 'caution',
  riskReason:
    'Downloads code and runs the build command you gave, which is that project’s own code running on your server with your account’s rights. Only deploy repositories you trust.',
  recordable: false,
  longRunning: true,
  internal: true,
});

export const fetchProject = defineAction({
  id: 'projects.fetch',
  title: 'Check a project for updates',
  explain:
    'Runs git fetch to learn what is new on the remote, then lists the commits you have not deployed yet. Nothing is changed in the project’s files.',
  params: z.object({ name: projectName }),
  commands: ({ name }) => [
    NEED_GIT,
    `${git} -C ${dir(name)} fetch --prune origin`,
    `${git} -C ${dir(name)} log --oneline HEAD..@{u} | head -n 20 || true`,
  ],
  risk: 'safe',
  recordable: false,
  internal: true,
});

export const installProjectEnv = defineAction({
  id: 'projects.env.install',
  title: 'Save a project’s environment variables',
  explain:
    'Your variables were uploaded to a temporary file on the server (so they never appear in a command line or in GFV’s history). This moves it to the project’s .env file with mode 600 (only you can read it), deletes the temporary file, and restarts the service if one is installed.',
  params: z.object({
    name: projectName,
    tmp: z.string().regex(/^\/tmp\/gfv-env-[A-Za-z0-9]{8,32}$/, 'not a GFV temporary file'),
  }),
  commands: ({ name, tmp }, ctx) => [
    `[ -d ${dir(name)} ] || { echo "Deploy the project first." >&2; exit 1; }`,
    `install -m 600 -- ${shellQuote(tmp)} ${dir(name)}/.env`,
    `rm -f -- ${shellQuote(tmp)}`,
    restartIfInstalled(name, ctx),
  ],
  risk: 'caution',
  riskReason:
    'Replaces the project’s environment variables, which can contain secrets, and restarts the app.',
  recordable: false,
  internal: true,
});

export const installProjectService = defineAction({
  id: 'projects.service.install',
  title: 'Run a project as a service',
  explain:
    'Writes a systemd unit (gfv-<name>.service) that runs your start command in the project folder as your user, with the project’s .env, and restarts it if it crashes. Then it reloads systemd and enables and starts the service, so it also starts at every boot.',
  params: z.object({ name: projectName, start: requiredUserCommand }),
  snapshotPaths: ({ name }) => [unitPath(name)],
  commands: ({ name, start }, ctx) => {
    const user = ctx.user ?? 'user';
    const unit = renderUnit({ name, start, home: ctx.home ?? `/home/${user}`, user });
    return [
      `[ -d ${dir(name)} ] || { echo "Deploy the project first." >&2; exit 1; }`,
      `printf '%s' ${shellQuote(unit)} | ${ctx.sudo}tee ${unitPath(name)} >/dev/null`,
      `${ctx.sudo}systemctl daemon-reload`,
      `${ctx.sudo}systemctl enable --now ${unitName(name)}`,
    ];
  },
  risk: 'caution',
  riskReason:
    'Creates a system service that runs your start command automatically, at boot and after crashes. It runs as your user, not root.',
  recordable: false,
  internal: true,
});

export const removeProject = defineAction({
  id: 'projects.remove',
  title: 'Remove a project',
  explain:
    'Stops and disables the project’s service, deletes its unit file (a backup is saved first), and deletes the project folder ~/gfv-projects/<name> including its .env file.',
  params: z.object({ name: projectName }),
  snapshotPaths: ({ name }) => [unitPath(name)],
  commands: ({ name }, ctx) => [
    `${ctx.sudo}systemctl disable --now ${unitName(name)} 2>/dev/null || true`,
    `${ctx.sudo}rm -f ${unitPath(name)}`,
    `${ctx.sudo}systemctl daemon-reload`,
    `rm -rf -- ${dir(name)}`,
  ],
  risk: 'danger',
  riskReason: 'Permanently deletes the project folder, including its .env file. There is no undo.',
  recordable: false,
  internal: true,
});

export { envKey };
export const projectActions = [
  listProjects,
  deployProject,
  fetchProject,
  installProjectEnv,
  installProjectService,
  removeProject,
];
