import { TOOL_IDS, type ToolId } from './tools.js';

/** One quiet command that reports the distro, and each tool's version and service state. */
const ver = (name: ToolId, probe: string, bin: string) =>
  `echo "==${name}"; command -v ${bin} >/dev/null 2>&1 && ${probe} 2>&1 | head -n 1 || echo NOTFOUND`;
const active = (name: ToolId, unit: string) =>
  `echo "==${name}.active"; systemctl is-active ${unit} 2>/dev/null | head -n 1`;

export const DETECT_COMMAND = [
  'echo "==os"; cat /etc/os-release 2>/dev/null',
  // nvm's Node is not on PATH in a plain SSH command, so look there first.
  'echo "==node"; if [ -s "$HOME/.nvm/nvm.sh" ]; then bash -c \'. "$HOME/.nvm/nvm.sh" && node -v\' 2>&1 | head -n 1; ' +
    'elif command -v node >/dev/null 2>&1; then node -v | head -n 1; else echo NOTFOUND; fi',
  ver('python', 'python3 --version', 'python3'),
  ver('docker', 'docker --version', 'docker'),
  active('docker', 'docker'),
  ver('postgresql', 'psql --version', 'psql'),
  active('postgresql', 'postgresql'),
  ver('nginx', 'nginx -v', 'nginx'),
  active('nginx', 'nginx'),
  ver('git', 'git --version', 'git'),
].join('; ');

export interface ToolStatus {
  installed: boolean;
  version?: string;
  /** For tools that run as a service. */
  running?: boolean;
}

export interface DevHubStatus {
  os: { pretty: string; supported: boolean };
  tools: Record<ToolId, ToolStatus>;
}

export function parseDetect(text: string): DevHubStatus {
  const sec = new Map<string, string>();
  let name = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('==')) {
      name = line.slice(2).trim();
      sec.set(name, '');
    } else if (name) sec.set(name, `${sec.get(name)}${line}\n`);
  }

  const osText = sec.get('os') ?? '';
  const field = (k: string) =>
    new RegExp(`^${k}=(.*)$`, 'm').exec(osText)?.[1]?.replace(/^"|"$/g, '') ?? '';
  const family = `${field('ID')} ${field('ID_LIKE')}`;

  const tools = {} as Record<ToolId, ToolStatus>;
  for (const id of TOOL_IDS) {
    const raw = (sec.get(id) ?? '').trim();
    const version = /(\d+(?:\.\d+)+)/.exec(raw)?.[1];
    const installed = raw !== '' && !raw.includes('NOTFOUND') && !!version;
    const a = (sec.get(`${id}.active`) ?? '').trim();
    tools[id] = {
      installed,
      ...(installed && version ? { version } : {}),
      ...(a ? { running: a === 'active' } : {}),
    };
  }
  return {
    os: {
      pretty: field('PRETTY_NAME') || 'unknown system',
      supported: /\b(ubuntu|debian)\b/.test(family),
    },
    tools,
  };
}
