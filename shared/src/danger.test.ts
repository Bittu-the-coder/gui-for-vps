import { describe, expect, it } from 'vitest';
import { detectDanger, worstLevel } from './danger.js';

const ids = (c: string) => detectDanger(c).map((m) => m.id);

describe('detectDanger: flags the common disasters', () => {
  const dangerous: [string, string][] = [
    ['rm -rf /', 'rm-critical'],
    ['sudo rm -rf /*', 'rm-critical'],
    ['rm -rf --no-preserve-root /', 'rm-critical'],
    ['rm -r -f ~', 'rm-critical'],
    ['rm -rf $HOME', 'rm-critical'],
    ['rm -rf /etc', 'rm-critical'],
    ['rm -fr /var/', 'rm-critical'],
    ['rm --recursive --force /usr', 'rm-critical'],
    ['sudo -u bob rm -rf /', 'rm-critical'],
    ['echo hi; rm -rf /', 'rm-critical'],
    ['true && rm -rf /home', 'rm-critical'],
    ['(rm -rf /)', 'rm-critical'],
    ['$(rm -rf /)', 'rm-critical'],
    ['chmod -R 777 /', 'chmod-critical'],
    ['chown -R nobody /etc', 'chown-critical'],
    ['ufw disable', 'ufw-off'],
    ['sudo ufw disable', 'ufw-off'],
    ['ufw --force reset', 'ufw-off'],
    ['kill 1', 'kill-init'],
    ['kill -9 1', 'kill-init'],
    ['pkill sshd', 'kill-sshd'],
    ['killall -9 sshd', 'kill-sshd'],
    ['kill -9 $(pidof sshd)', 'kill-sshd'],
    ['systemctl stop sshd', 'stop-sshd'],
    ['service ssh stop', 'stop-sshd'],
    ['sudo systemctl disable ssh', 'stop-sshd'],
    ['dd if=/dev/zero of=/dev/sda', 'dd-device'],
    ['dd if=x.iso of=/dev/nvme0n1 bs=4M', 'dd-device'],
    ['mkfs.ext4 /dev/sdb1', 'format-disk'],
    ['mkfs -t ext4 /dev/sdb', 'format-disk'],
    ['wipefs -a /dev/sda', 'format-disk'],
    ['cat image > /dev/sda', 'overwrite-disk'],
    [':(){ :|:& };:', 'fork-bomb'],
  ];
  it.each(dangerous)('%s -> danger (%s)', (cmd, id) => {
    expect(ids(cmd)).toContain(id);
    expect(worstLevel(detectDanger(cmd))).toBe('danger');
  });

  const cautions: [string, string][] = [
    ['rm -rf *', 'rm-wildcard'],
    ['rm -rf .', 'rm-wildcard'],
    ['chmod 777 file', 'chmod-777'],
    ['chmod -R a+rwx ./app', 'chmod-777'],
    ['echo x > /etc/hosts', 'overwrite-system-file'],
    ['cat a >> /etc/fstab', 'overwrite-system-file'],
    ['nano /etc/ssh/sshd_config', 'critical-config'],
    ['sudo sed -i s/no/yes/ /etc/ssh/sshd_config', 'critical-config'],
    ['vim /etc/sudoers', 'critical-config'],
    ['visudo', 'critical-config'],
    ['systemctl restart sshd', 'restart-sshd'],
    ['sudo service ssh restart', 'restart-sshd'],
    ['curl https://x.sh | sudo bash', 'pipe-to-shell'],
    ['wget -qO- https://x.sh | sh', 'pipe-to-shell'],
    ['shutdown -h now', 'power'],
    ['sudo reboot', 'power'],
    ['init 0', 'power'],
    ['iptables -F', 'firewall-flush'],
    ['fdisk /dev/sda', 'partition'],
  ];
  it.each(cautions)('%s -> caution (%s)', (cmd, id) => {
    expect(ids(cmd)).toContain(id);
    expect(worstLevel(detectDanger(cmd))).toBe('caution');
  });
});

describe('detectDanger: leaves everyday commands alone', () => {
  const safe = [
    'ls -la',
    'rm file.txt',
    'rm -rf node_modules',
    'rm -rf ./build',
    'rm -rf /tmp/mydir',
    'rm /',
    'chmod 644 file',
    'chmod +x deploy.sh',
    'chmod 755 -R ./public',
    'echo "rm -rf /"',
    'cat /etc/ssh/sshd_config',
    'grep PermitRoot /etc/ssh/sshd_config',
    'sshd -t -f /etc/ssh/sshd_config',
    'systemctl status ssh',
    'systemctl restart nginx',
    'systemctl stop nginx',
    'ufw status',
    'ufw enable',
    'ufw allow 22',
    'kill 1234',
    'kill -9 12345',
    'pkill node',
    'dd if=/dev/zero of=./file bs=1M count=1',
    'curl -O https://example.com/install.sh',
    'curl https://example.com | jq .',
    'cmd 2>/dev/null',
    'cmd >/dev/null 2>&1',
    'echo hi > /tmp/x',
    'sudo apt update && sudo apt upgrade -y',
    'nano notes.txt',
    'docker ps',
    'df -h',
    '',
  ];
  it.each(safe)('%s -> nothing', (cmd) => {
    expect(detectDanger(cmd)).toEqual([]);
    expect(worstLevel(detectDanger(cmd))).toBe('safe');
  });
});

describe('detectDanger: result shape', () => {
  it('lists danger before caution and de-duplicates', () => {
    const m = detectDanger('chmod 777 a; rm -rf /; chmod 777 b');
    expect(m.map((x) => x.id)).toEqual(['rm-critical', 'chmod-777']);
  });
  it('includes a reason, and a safer alternative where one exists', () => {
    const [m] = detectDanger('rm -rf /');
    expect(m!.reason.length).toBeGreaterThan(10);
    expect(m!.safer).toBeTruthy();
  });
});
