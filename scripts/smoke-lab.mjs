import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArpLab } from '../src/labs/l2-arp.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lab = createArpLab(path.join(root, 'lab'));
const run = promisify(execFile);
try {
  await lab.start();
  const baseline = await lab.baseline();
  console.log('baseline', baseline);
  assert.equal(baseline.baseline, baseline.serviceMac);
  assert.equal(baseline.service_before, true);
  await assert.rejects(lab.poison(), /Check the two sender fields/);
  await run('docker', ['exec', 'net412l2-attacker-1', 'sed', '-i', 's/forged_sender_ip = "REPLACE_WITH_SERVICE_IP"/forged_sender_ip = service_ip/', '/work/poison_student.py']);
  await run('docker', ['exec', 'net412l2-attacker-1', 'sed', '-i', 's/forged_sender_mac = "REPLACE_WITH_ATTACKER_MAC"/forged_sender_mac = attacker_mac/', '/work/poison_student.py']);
  const poisoned = await lab.poison();
  console.log('poisoned', poisoned);
  assert.equal(poisoned.poisoned, baseline.attackerMac);
  assert.equal(poisoned.attacker_http_seen, true);
  assert.equal(poisoned.source_test_passed, true);
  assert.equal(poisoned.service_after, true);
  await lab.reset();
  await lab.start();
  const restored = await lab.baseline();
  const hardened = await lab.harden();
  console.log('hardened', hardened);
  assert.equal(hardened.hardened, restored.serviceMac);
  assert.equal(hardened.service_hardened, true);
  console.log('ARP lab smoke test passed');
} finally {
  await lab.reset();
}
