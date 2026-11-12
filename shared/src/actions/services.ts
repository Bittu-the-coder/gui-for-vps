import { z } from 'zod';
import { shellQuote } from '../shell.js';
import { defineAction, type ActionDef } from './define.js';

export const LIST_SERVICES_COMMAND =
  'echo "==units"; systemctl list-units --type=service --all --no-legend --no-pager --plain; ' +
  'echo "==files"; systemctl list-unit-files --type=service --no-legend --no-pager';

const unit = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9:_.@\\-]+\.service$/, 'must be a service name ending in .service');
const unitParams = z.object({ unit });

export const listServices = defineAction({
  id: 'services.list',
  title: 'List services',
  explain:
    'systemctl is the control panel for systemd, the program that starts and supervises services. list-units shows what is loaded and running; list-unit-files shows which services start at boot.',
  params: z.object({}),
  commands: () => [LIST_SERVICES_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const serviceLogs = defineAction({
  id: 'services.logs',
  title: 'Read service logs',
  explain:
    'journalctl reads the system journal, where services write their logs. -u picks one service, -n limits how many recent lines to show.',
  params: z.object({ unit, lines: z.number().int().min(10).max(1000).default(200) }),
  commands: ({ unit, lines }, ctx) => [
    `${ctx.sudo}journalctl -u ${shellQuote(unit)} -n ${lines} --no-pager`,
  ],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

// Services whose loss can lock you out of the server.
const CRITICAL =
  /^(ssh|sshd|systemd-networkd|networking|NetworkManager|systemd-logind|dbus)\.service$/;

function svc(
  verb: 'start' | 'stop' | 'restart' | 'enable' | 'disable',
  title: string,
  explain: string,
  risk: 'safe' | 'caution',
  riskReason: string,
  lockout: boolean,
): ActionDef<typeof unitParams> {
  return defineAction({
    id: `service.${verb}`,
    title,
    explain,
    params: unitParams,
    commands: ({ unit }, ctx) => [`${ctx.sudo}systemctl ${verb} ${shellQuote(unit)}`],
    risk,
    riskReason,
    dynamicRisk: lockout
      ? ({ unit }) =>
          CRITICAL.test(unit)
            ? {
                risk: 'danger',
                reason: `${unit} keeps the server reachable. Stopping or disabling it can lock you out.`,
              }
            : undefined
      : undefined,
    recordable: true,
    internal: true,
  });
}

export const serviceActions = [
  listServices,
  serviceLogs,
  svc(
    'start',
    'Start a service',
    'Starts the service now. It will not start by itself after a reboot unless it is also enabled.',
    'caution',
    'Starting a service changes what is running on the server.',
    false,
  ),
  svc(
    'stop',
    'Stop a service',
    'Stops the service now. Anything that depends on it stops working until it is started again.',
    'caution',
    'Programs and visitors that use this service lose access to it.',
    true,
  ),
  svc(
    'restart',
    'Restart a service',
    'Stops the service and starts it again, which makes it reload its configuration. Connections to it drop for a moment.',
    'caution',
    'Connections to the service drop while it restarts.',
    false,
  ),
  svc(
    'enable',
    'Start a service at boot',
    'Makes the service start automatically every time the server boots. It does not start it right now.',
    'caution',
    'Changes what runs at boot.',
    false,
  ),
  svc(
    'disable',
    'Do not start at boot',
    'Stops the service from starting automatically at boot. It keeps running now if it already is.',
    'caution',
    'The service will be missing after the next reboot.',
    true,
  ),
];
