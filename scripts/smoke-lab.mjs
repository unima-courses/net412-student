import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArpLab } from '../src/labs/l2-arp.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.NET412_L2_PROJECT ||= `net412-smoke-${process.pid}`;
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-arp-fixture-'));
// Keep the test separate from a learner lab using the standard subnet.
const subnet = process.env.NET412_TEST_SUBNET || '10.77.212';
assert.match(subnet, /^10\.77\.[0-9]{1,3}$/);
for (const file of await fs.readdir(path.join(root, 'lab'))) {
  const content = await fs.readFile(path.join(root, 'lab', file), 'utf8');
  await fs.writeFile(path.join(fixture, file), content.replaceAll('10.77.12', subnet));
}
const lab = createArpLab(fixture);
const run = promisify(execFile);
const exportedPcap = path.join(os.tmpdir(), `net412-smoke-${process.pid}.pcap`);
const inside = async (target, ...args) => (await run('docker', ['exec', lab.containerName(target), ...args.map(value => value.replaceAll('10.77.12', subnet))])).stdout.trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function startCapture() {
  await run('docker', ['exec', '-d', lab.containerName('host_b'), 'tcpdump', '-U', '-i', 'eth0', '-s', '0', '-w', '/work/attack.pcap', 'arp or tcp port 8080']);
  await pause(500);
}
async function stopCapture() {
  // Allow libpcap's kernel block timeout to deliver the final packets before SIGINT.
  await pause(1200);
  await inside('host_b', 'sh', '-c', 'kill -INT $(pidof tcpdump)');
  for (let i = 0; i < 20; i++) {
    if (!(await inside('host_b', 'sh', '-c', 'pidof tcpdump || true'))) return;
    await pause(100);
  }
  throw new Error('tcpdump did not stop');
}
try {
  assert.equal((await lab.status()).running, false, 'Refusing to alter an existing test project');
  await lab.start();
  const truth = await lab.groundTruth();
  assert.equal(Object.keys(truth).length, 3);
  await inside('host_a', 'python', '/work/request.py');
  const baseline = await inside('host_a', 'ip', 'neigh', 'show', '10.77.12.20');
  assert.ok(baseline.includes(truth.server_1_mac));
  assert.equal(await inside('host_b', 'sh', '-c', 'test ! -e /work/attack.pcap && echo absent'), 'absent', 'Start must never start a capture');
  await assert.rejects(lab.exportPcap(exportedPcap), /No valid PCAP/);
  await inside('host_b', 'sed', '-i', 's/forged_sender_ip = "REPLACE_WITH_SERVER_1_IP"/forged_sender_ip = server_1_ip/', '/work/poison_student.py');
  await inside('host_b', 'sed', '-i', 's/forged_sender_mac = "REPLACE_WITH_HOST_B_MAC"/forged_sender_mac = host_b_mac/', '/work/poison_student.py');
  await startCapture();
  // Let the normal neighbor locktime expire after the freshly learned baseline.
  await pause(1500);
  await inside('host_b', 'python', '/work/poison_student.py');
  assert.ok((await inside('host_a', 'ip', 'neigh', 'show', '10.77.12.20')).includes(truth.host_b_mac));
  const visible = await inside('host_a', 'python', '/work/request.py');
  assert.match(visible, /response for host_a/);
  assert.doesNotMatch(visible, /fragment|REQUEST_FRAGMENT|RESPONSE_FRAGMENT/);
  await stopCapture();
  const oneWay = await inside('host_b', 'tcpdump', '-nn', '-A', '-r', '/work/attack.pcap', 'tcp port 8080');
  assert.match(oneWay, /request-fragment: REQUEST_FRAGMENT/);
  assert.doesNotMatch(oneWay, /response-fragment: RESPONSE_FRAGMENT/);
  // Independent solution used only by the maintainer test, never included in learner commands.
  await inside('host_b', 'sh', '-c', 'cp /work/poison_student.py /work/reverse.py');
  await inside('host_b', 'sed', '-i', 's/host_a_ip = "10.77.12.10"/host_a_ip = "10.77.12.20"/;s/server_1_ip = "10.77.12.20"/server_1_ip = "10.77.12.10"/', '/work/reverse.py');
  await startCapture();
  await inside('host_b', 'python', '/work/poison_student.py');
  await inside('host_b', 'python', '/work/reverse.py');
  assert.ok((await inside('server_1', 'ip', 'neigh', 'show', '10.77.12.10')).includes(truth.host_b_mac));
  await inside('host_a', 'python', '/work/request.py');
  await stopCapture();
  const bothWays = await inside('host_b', 'tcpdump', '-nn', '-A', '-r', '/work/attack.pcap', 'tcp port 8080');
  assert.match(bothWays, /request-fragment: REQUEST_FRAGMENT/);
  assert.match(bothWays, /response-fragment: RESPONSE_FRAGMENT/);
  const otherResponse = await inside('host_b', 'curl', '-sS', '-d', '<!-- request-fragment: x -->', 'http://10.77.12.20:8080/');
  assert.match(otherResponse, /response for host_b or another host/);
  assert.doesNotMatch(otherResponse, /response-fragment: RESPONSE_FRAGMENT/);
  await lab.exportPcap(exportedPcap);
  const bytes = await fs.readFile(exportedPcap);
  assert.ok(bytes.length > 24);
  assert.ok(['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(bytes.subarray(0, 4).toString('hex')));
  console.log('Explicit capture, one-way and two-way poisoning, source-specific response, runtime MACs and PCAP export passed');
} finally {
  await lab.reset();
  await fs.unlink(exportedPcap).catch(() => {});
  await fs.rm(fixture, { recursive: true, force: true });
}
