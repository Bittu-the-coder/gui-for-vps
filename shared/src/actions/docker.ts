import { z } from 'zod';
import { shellQuote } from '../shell.js';
import { defineAction, type ActionDef } from './define.js';

export const DOCKER_PS_COMMAND = "docker ps -a --format '{{json .}}'";
export const DOCKER_IMAGES_COMMAND = "docker images --format '{{json .}}'";

// Container names/IDs and image refs: no spaces, no leading dash (can't be read as a flag).
const ref = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/, 'not a valid container or image name');
const refParams = z.object({ name: ref });

export const dockerList = defineAction({
  id: 'docker.list',
  title: 'List containers',
  explain:
    'docker ps -a lists every container, running or stopped. --format with {{json .}} prints each one as a line of JSON so GFV can read it.',
  params: z.object({}),
  commands: (_p, ctx) => [`${ctx.sudo}${DOCKER_PS_COMMAND}`],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const dockerImages = defineAction({
  id: 'docker.images',
  title: 'List images',
  explain:
    'docker images lists the images (the templates containers are created from) stored on this server.',
  params: z.object({}),
  commands: (_p, ctx) => [`${ctx.sudo}${DOCKER_IMAGES_COMMAND}`],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const dockerLogs = defineAction({
  id: 'docker.logs',
  title: 'Read container logs',
  explain:
    'docker logs prints what a container wrote to its output. --tail limits it to the most recent lines; 2>&1 includes error output too.',
  params: z.object({ name: ref, lines: z.number().int().min(10).max(1000).default(200) }),
  commands: ({ name, lines }, ctx) => [
    `${ctx.sudo}docker logs --tail ${lines} ${shellQuote(name)} 2>&1`,
  ],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

function dk(
  id: string,
  verb: string,
  title: string,
  explain: string,
  risk: 'safe' | 'caution',
  riskReason: string,
): ActionDef<typeof refParams> {
  return defineAction({
    id,
    title,
    explain,
    params: refParams,
    commands: ({ name }, ctx) => [`${ctx.sudo}docker ${verb} ${shellQuote(name)}`],
    risk,
    riskReason,
    recordable: true,
    internal: true,
  });
}

export const dockerActions = [
  dockerList,
  dockerImages,
  dockerLogs,
  dk(
    'docker.start',
    'start',
    'Start a container',
    'Starts a stopped container with the settings it was created with.',
    'safe',
    '',
  ),
  dk(
    'docker.stop',
    'stop',
    'Stop a container',
    'Asks the program in the container to shut down (SIGTERM), and force-stops it after 10 seconds if it does not.',
    'caution',
    'Whatever the container serves goes offline.',
  ),
  dk(
    'docker.restart',
    'restart',
    'Restart a container',
    'Stops the container and starts it again.',
    'caution',
    'The container is briefly offline.',
  ),
  dk(
    'docker.rm',
    'rm',
    'Remove a container',
    'Deletes a stopped container. Data stored only inside the container is lost; volumes are kept. A running container must be stopped first.',
    'caution',
    'Data that lives only inside the container is deleted.',
  ),
  dk(
    'docker.rmi',
    'rmi',
    'Remove an image',
    'Deletes an image from this server. Containers using it must be removed first. You can pull it again later.',
    'caution',
    'You will need to download the image again to use it.',
  ),
];
