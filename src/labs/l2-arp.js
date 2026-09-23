import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
const project = 'net412l2';
const containers = new Set(['victim', 'service', 'attacker']);
const name = target => `${project}-${target}-1`;
async function docker(args, timeout = 30000) {
  return (await exec('docker', args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}
const inside = (target, args, timeout) => docker(['exec', name(target), ...args], timeout);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const macFrom = text => text.match(/lladdr\s+([0-9a-f:]{17})/i)?.[1]?.toLowerCase() || '';

export function createArpLab(labDir) {
  const compose = ['compose', '-p', project, '-f', path.join(labDir, 'compose.yaml')];
  let busy = false;
  async function guarded(action) {
    if (busy) throw new Error('Another lab action is running');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  return {
    id: 'l2-arp',
    taskIds: new Set(['l2.a', 'l2.b']),
    terminalTargets: containers,
    containerName: name,
    async status() {
      try { return { running: (await docker([...compose, 'ps', '--status', 'running', '-q'])).split('\n').filter(Boolean).length === 3 }; }
      catch { return { running: false }; }
    },
    start: () => guarded(async () => {
      await docker([...compose, 'up', '--build', '-d', '--wait'], 600000);
      return { message: 'Three isolated lab containers are running.' };
    }),
    reset: () => guarded(async () => {
      await docker([...compose, 'down', '--volumes', '--remove-orphans'], 120000);
      return { message: 'Lab containers and their network were removed.' };
    }),
    baseline: () => guarded(async () => {
      const response = await inside('victim', ['curl', '-sS', '-m', '5', 'http://10.77.12.20:8080/']);
      const neighbour = await inside('victim', ['ip', 'neigh', 'show', '10.77.12.20']);
      const serviceMac = (await inside('service', ['cat', '/sys/class/net/eth0/address'])).toLowerCase();
      const attackerMac = (await inside('attacker', ['cat', '/sys/class/net/eth0/address'])).toLowerCase();
      return { response, neighbour, baseline: macFrom(neighbour), serviceMac, attackerMac,
        service_before: response.includes('NET412 legitimate service response') };
    }),
    poison: () => guarded(async () => {
      await inside('attacker', ['python', '/work/poison_student.py', '--check'], 10000);
      await inside('attacker', ['sh', '-c', 'rm -f /work/attack.pcap; timeout 15 tcpdump -U -i eth0 -s 0 -w /work/attack.pcap "host 10.77.12.10 and tcp port 8080" >/work/capture.log 2>&1 &']);
      await sleep(800);
      const sourceResult = await inside('attacker', ['python', '/work/poison_student.py'], 20000);
      const response = await inside('victim', ['curl', '-sS', '-m', '6', 'http://10.77.12.20:8080/']);
      const neighbour = await inside('victim', ['ip', 'neigh', 'show', '10.77.12.20']);
      await sleep(1000);
      let capture = '';
      try { capture = await inside('attacker', ['tcpdump', '-A', '-r', '/work/attack.pcap']); } catch { /* capture may still be starting */ }
      const source = await inside('attacker', ['cat', '/work/poison_student.py']);
      return { response, neighbour, poisoned: macFrom(neighbour), source_test_passed: sourceResult.includes('Sent 16 bounded'), source,
        attacker_http_seen: capture.includes('GET / HTTP/1.1'),
        service_after: response.includes('NET412 legitimate service response'),
        capturePreview: capture.slice(0, 2400) };
    }),
    harden: () => guarded(async () => {
      const serviceMac = (await inside('service', ['cat', '/sys/class/net/eth0/address'])).toLowerCase();
      await inside('victim', ['ip', 'neigh', 'replace', '10.77.12.20', 'lladdr', serviceMac, 'nud', 'permanent', 'dev', 'eth0']);
      await inside('attacker', ['python', '/opt/lab/poison.py'], 20000);
      const response = await inside('victim', ['curl', '-sS', '-m', '5', 'http://10.77.12.20:8080/']);
      const neighbour = await inside('victim', ['ip', 'neigh', 'show', '10.77.12.20']);
      return { neighbour, hardened: macFrom(neighbour),
        service_hardened: response.includes('NET412 legitimate service response'), response };
    }),
    async exportPcap(targetPath) { await docker(['cp', `${name('attacker')}:/work/attack.pcap`, targetPath]); },
    evidenceFor(taskId, draft) {
      if (taskId === 'l2.a') return {
        mapping: { baseline: draft.baseline?.baseline, poisoned: draft.poison?.poisoned, attacker: draft.baseline?.attackerMac },
        attacker_http_seen: draft.poison?.attacker_http_seen, service_after: draft.poison?.service_after,
        source_test_passed: draft.poison?.source_test_passed, source: draft.poison?.source,
        neighbour_before: draft.baseline?.neighbour, neighbour_after: draft.poison?.neighbour,
        capture_preview: draft.poison?.capturePreview
      };
      if (taskId === 'l2.b') return {
        hardening_mapping: { baseline: draft.baseline?.baseline, hardened: draft.harden?.hardened },
        service_hardened: draft.harden?.service_hardened, neighbour_after: draft.harden?.neighbour
      };
      throw new Error('Unknown ARP task');
    }
  };
}
