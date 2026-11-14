import type { Lesson } from './engine.js';

const folder = 'gfv-lesson';

/** The lessons that ship with GFV. Every "do" step uses a real action; a test checks that they all exist. */
export const LESSONS: Lesson[] = [
  {
    id: 'first-commands',
    title: 'Your first command',
    summary: 'Run a real command on your server and learn to read what it tells you.',
    level: 'beginner',
    minutes: 5,
    steps: [
      {
        type: 'read',
        title: 'A command is a question',
        body: 'Every click in GFV runs a command on your server: a short instruction in text. GFV always shows you the command first. Reading it is how you learn what the server is really doing.',
      },
      {
        type: 'do',
        title: 'Ask the server how long it has been running',
        body: 'Press Ctrl+K, type “uptime”, and choose “Run: Show uptime and load”. Read the preview, then press Run.',
        actionId: 'system.uptime',
        runForMe: { params: {}, label: 'Run it for me' },
      },
      {
        type: 'quiz',
        title: 'Check your understanding',
        question:
          'Which command prints how long the server has been running, and the load average?',
        options: ['uptime', 'whoami', 'mkdir', 'chmod'],
        answer: 0,
        explain:
          '`uptime` prints the time, how long the machine has been up, how many users are logged in, and the load averages for the last 1, 5 and 15 minutes.',
      },
      {
        type: 'quiz',
        title: 'Reading the load',
        question: 'A server with 4 CPU cores shows a load average of 0.40. What does that mean?',
        options: [
          'It is almost idle: only a small part of its capacity is in use',
          'It is overloaded and about to crash',
          'It ran out of memory',
          'It has been up for 0.4 days',
        ],
        answer: 0,
        explain:
          'Load is the average number of tasks that want a CPU. About 1.0 per core means "busy"; 0.40 on 4 cores is very quiet.',
      },
    ],
  },
  {
    id: 'files-and-folders',
    title: 'Files, folders and the Safety Net',
    summary: 'Make a folder, delete it, and see why GFV asks you to confirm.',
    level: 'beginner',
    minutes: 8,
    steps: [
      {
        type: 'do',
        title: `Create a folder called ${folder}`,
        body: `Open the Files app, press “New folder”, and name it ${folder}. Read the preview: it is a single mkdir command.`,
        actionId: 'files.mkdir',
        paramContains: folder,
        app: 'files',
      },
      {
        type: 'quiz',
        title: 'What mkdir -p means',
        question: 'The preview said `mkdir -p`. What does the -p flag do?',
        options: [
          'Creates missing parent folders, and is not an error if the folder already exists',
          'Makes the folder private',
          'Prints the folder afterwards',
          'Protects the folder from being deleted',
        ],
        answer: 0,
        explain: '-p ("parents") makes the command safe to repeat: running it twice does not fail.',
      },
      {
        type: 'do',
        title: 'Delete it again',
        body: `Select ${folder} in the Files app and press Delete. This one is marked dangerous: tick the box that says you understand the risk before it will run.`,
        actionId: 'files.delete-path',
        paramContains: folder,
        app: 'files',
      },
      {
        type: 'quiz',
        title: 'Why the extra checkbox?',
        question: 'Why did GFV make you tick “I understand the risk” before deleting?',
        options: [
          'Deleting cannot be undone, so it asks you to slow down and confirm',
          'Because the folder was too big',
          'Because you are not the owner',
          'It always asks, for every action',
        ],
        answer: 0,
        explain:
          'That is the Safety Net: risky actions (caution or danger) need a deliberate confirmation, and the server checks it too, so nothing can skip it.',
      },
    ],
  },
  {
    id: 'safety-net',
    title: 'Dangerous commands',
    summary: 'Learn to recognise the commands that can lock you out or destroy data.',
    level: 'intermediate',
    minutes: 6,
    steps: [
      {
        type: 'quiz',
        title: 'Permissions',
        question: 'Why is `chmod 777` on a folder usually a bad idea?',
        options: [
          'Everyone on the machine can read, change and run what is inside',
          'It makes the folder invisible',
          'It deletes the contents',
          'It only works for the root user',
        ],
        answer: 0,
        explain:
          '777 gives read, write and execute to the owner, the group and everybody else. Prefer the smallest permission that works, like 755 for folders or 644 for files.',
      },
      {
        type: 'quiz',
        title: 'The big one',
        question: 'What does `rm -rf /` do?',
        options: [
          'Tries to delete everything on the machine',
          'Removes the root user',
          'Restarts the firewall',
          'Lists all files recursively',
        ],
        answer: 0,
        explain:
          '-r means "recursively" and -f means "without asking". Together with / (the top of the filesystem) it is the classic way to destroy a server. GFV holds this command until you confirm.',
      },
      {
        type: 'quiz',
        title: 'Editing sshd_config',
        question: 'You edit /etc/ssh/sshd_config and make a typo. What is the real risk?',
        options: [
          'SSH may refuse to start, and you lose the only way into the server',
          'The server restarts',
          'Your files are deleted',
          'Nothing: the file is only a suggestion',
        ],
        answer: 0,
        explain:
          'That is why GFV warns before saving critical config files and keeps a backup you can restore from the Snapshots app.',
      },
    ],
  },
  {
    id: 'services-and-logs',
    title: 'Services and logs',
    summary: 'How a server keeps programs running, and where to look when one stops.',
    level: 'intermediate',
    minutes: 6,
    steps: [
      {
        type: 'read',
        title: 'systemd supervises services',
        body: 'On most Linux servers a program called systemd starts your services (nginx, PostgreSQL, SSH), restarts them if they fail, and starts them at boot. You talk to it with `systemctl`.',
      },
      {
        type: 'quiz',
        title: 'start vs enable',
        question:
          'What is the difference between `systemctl start nginx` and `systemctl enable nginx`?',
        options: [
          'start runs it now; enable makes it start at every boot',
          'They are the same',
          'start installs it; enable removes it',
          'enable is only for root',
        ],
        answer: 0,
        explain:
          'You often want both: start for right now, enable so it survives a reboot. `enable --now` does both at once.',
      },
      {
        type: 'quiz',
        title: 'Where are the logs?',
        question: 'A service keeps failing. Which command shows its recent log lines?',
        options: ['journalctl -u nginx -n 100', 'ls /logs', 'cat nginx', 'systemctl log'],
        answer: 0,
        explain:
          'journalctl reads the system journal. -u picks one service and -n limits the lines. The Services app has a Logs button that runs exactly this.',
      },
    ],
  },
  {
    id: 'recipes-and-scripts',
    title: 'Turning clicks into scripts',
    summary: 'Record what you do once, then repeat it on another server.',
    level: 'expert',
    minutes: 5,
    steps: [
      {
        type: 'read',
        title: 'A recipe is a recording',
        body: 'Press Record in the menu bar, use GFV normally, then press Stop. The steps become a recipe you can export as a bash script, a Dockerfile or an Ansible playbook, or replay on other servers from the Jobs app.',
      },
      {
        type: 'quiz',
        title: 'Parameters',
        question:
          'You want the same recipe to create /var/www/site-a on one server and /var/www/site-b on another. What do you use?',
        options: [
          'A parameter, written {{site}} in the step',
          'Two copies of the recipe',
          'Edit the exported script by hand each time',
          'Nothing: recipes cannot change',
        ],
        answer: 0,
        explain:
          'Parameters are filled in when the recipe runs. In an exported script they become environment variables like GFV_SITE.',
      },
      {
        type: 'quiz',
        title: 'Why safe to run twice?',
        question: 'Why does a recorded script use `mkdir -p` rather than plain `mkdir`?',
        options: [
          'So running the script again does not fail on folders that already exist',
          'It is faster',
          'Plain mkdir needs root',
          'It hides the output',
        ],
        answer: 0,
        explain: 'Idempotent steps (safe to repeat) are what make scripts reliable.',
      },
    ],
  },
];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
