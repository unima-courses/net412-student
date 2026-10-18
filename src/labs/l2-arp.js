import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
const containers = new Set(['host_a', 'host_b', 'server_1']);
async function docker(args, timeout = 30000) {
  return (await exec('docker', args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}

export function createArpLab(labDir, _spec, { runDocker = docker } = {}) {
  const project = process.env.NET412_L2_PROJECT || 'net412l2';
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project)) throw new Error('Invalid NET412 L2 Compose project name');
  const name = target => `${project}-${target}-1`;
  const inside = (target, args, timeout) => runDocker(['exec', name(target), ...args], timeout);
  const compose = ['compose', '-p', project, '-f', path.join(labDir, 'compose.yaml')];
  let busy = false;
  async function guarded(action) {
    if (busy) throw new Error('Another lab action is running');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  return {
    id: 'l2-arp',
    actions: new Set(['start', 'reset']),
    taskIds: new Set(['l2.a']),
    terminalTargets: containers,
    containerName: name,
    async status() {
      try {
        const ids = (await runDocker([...compose, 'ps', '--status', 'running', '-q'])).split('\n').filter(Boolean);
        if (ids.length !== containers.size) return { running: false };
        // A shared project may still contain an older student's/bundle's containers.
        const directories = (await runDocker(['inspect', '--format',
          '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}', ...ids])).split('\n');
        return { running: directories.length === ids.length && directories.every(directory => path.resolve(directory) === path.resolve(labDir)) };
      }
      catch { return { running: false }; }
    },
    start: () => guarded(async () => {
      try {
        await runDocker([...compose, 'up', '--build', '-d', '--wait', '--remove-orphans'], 600000);
      } catch (error) {
        if (/pool overlaps/i.test(error.stderr || error.message)) {
          throw new Error('The L2 subnet is already reserved by another Docker network. Reset the older L2 lab before starting this one. Other Docker networks have been left unchanged.');
        }
        throw error;
      }
      return { message: 'host_a, host_b and server_1 are running on the isolated lab network.' };
    }),
    reset: () => guarded(async () => {
      await runDocker([...compose, 'down', '--volumes', '--remove-orphans'], 120000);
      return { message: 'Lab containers and their network were removed.' };
    }),
    async groundTruth() {
      const values = await Promise.all([...containers].map(async target =>
        [target + '_mac', (await inside(target, ['cat', '/sys/class/net/eth0/address'])).toLowerCase()]));
      return Object.fromEntries(values);
    },
    async exportPcap(targetPath) {
      try {
        await inside('host_b', ['sh', '-c', 'test -s /work/attack.pcap && tcpdump -nn -r /work/attack.pcap -c 1 >/dev/null 2>&1']);
        await runDocker(['cp', `${name('host_b')}:/work/attack.pcap`, targetPath]);
      } catch {
        throw Object.assign(new Error('No valid PCAP is available. Start tcpdump in a terminal, generate traffic, then stop it with Ctrl+C before downloading.'), { status: 409 });
      }
    },
    evidenceFor(taskId) {
      if (taskId !== 'l2.a') throw new Error('Unknown ARP task');
      return {};
    }
  };
}
