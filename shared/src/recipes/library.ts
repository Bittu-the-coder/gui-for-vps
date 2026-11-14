import { RECIPE_FILE_FORMAT, type RecipeFile } from './share.js';

/**
 * Starter recipes that ship inside GFV (no network, no backend). They are ordinary recipe files: the same
 * validation, the same preview of every command, the same confirmation as anything you import. People can
 * share their own the same way (Share in the Recipes app produces this format).
 */
const tool = (id: string) => ({ actionId: `devhub.install.${id}`, params: {} });

export const BUNDLED_RECIPES: (RecipeFile & { id: string })[] = [
  {
    id: 'node-dev-box',
    format: RECIPE_FILE_FORMAT,
    name: 'Node.js dev box',
    description: 'Node.js 22 (via nvm) and Git, ready for a JavaScript project.',
    tags: ['node', 'javascript', 'dev'],
    author: 'GFV',
    params: [],
    steps: [tool('git'), tool('node')],
  },
  {
    id: 'web-server',
    format: RECIPE_FILE_FORMAT,
    name: 'Web server (nginx + Git)',
    description: 'nginx as a web server and reverse proxy, plus Git to fetch your site.',
    tags: ['nginx', 'web'],
    author: 'GFV',
    params: [],
    steps: [tool('git'), tool('nginx')],
  },
  {
    id: 'python-postgres',
    format: RECIPE_FILE_FORMAT,
    name: 'Python + PostgreSQL',
    description: 'Python 3 with pip and venv, and a PostgreSQL database server.',
    tags: ['python', 'postgres', 'database'],
    author: 'GFV',
    params: [],
    steps: [tool('python'), tool('postgresql')],
  },
  {
    id: 'mern-ubuntu',
    format: RECIPE_FILE_FORMAT,
    name: 'MERN-style stack on Ubuntu',
    description:
      'Node.js, Git, nginx and a project folder. (Add MongoDB with Docker from the Dev Hub.)',
    tags: ['node', 'nginx', 'mern'],
    author: 'GFV',
    params: [{ name: 'app', label: 'Project folder name', default: 'myapp' }],
    steps: [
      tool('git'),
      tool('node'),
      tool('nginx'),
      { actionId: 'files.mkdir', params: { path: '/var/www/{{app}}' } },
    ],
  },
  {
    id: 'docker-host',
    format: RECIPE_FILE_FORMAT,
    name: 'Docker host',
    description: 'Docker Engine and Git, for running containers.',
    tags: ['docker', 'containers'],
    author: 'GFV',
    params: [],
    steps: [tool('git'), tool('docker')],
  },
];
