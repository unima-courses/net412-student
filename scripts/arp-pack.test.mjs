import assert from 'node:assert/strict';
import test from 'node:test';
import { createArpLab } from '../src/labs/l2-arp.js';

test('bundle updates reuse the same fixed-subnet L2 project', async () => {
  const commands = [];
  const runDocker = async args => { commands.push(args); return ''; };
  const old = createArpLab('/tmp/l2-v1-old', undefined, { runDocker });
  const updated = createArpLab('/tmp/l2-v1-new', undefined, { runDocker });
  assert.equal(old.containerName('host_a'), 'net412l2-host_a-1');
  assert.equal(updated.containerName('host_a'), old.containerName('host_a'));
  await old.start(); await updated.start();
  assert.equal(commands[0][2], commands[1][2]);
  assert.notEqual(commands[0][4], commands[1][4]);
});

test('running containers from another bundle require a start before attaching', async () => {
  let directory = '/tmp/old-bundle';
  const lab = createArpLab('/tmp/current-bundle', undefined, {
    runDocker: async args => args[0] === 'inspect' ? [directory, directory, directory].join('\n') : 'a\nb\nc',
  });
  assert.equal((await lab.status()).running, false);
  directory = '/tmp/current-bundle';
  assert.equal((await lab.status()).running, true);
});

test('an unrelated subnet conflict gives guidance without deleting networks', async () => {
  const commands = [];
  const lab = createArpLab('/tmp/current-bundle', undefined, { runDocker: async args => {
    commands.push(args);
    throw Object.assign(new Error('docker failed'), { stderr: 'Pool overlaps with other one on this address space' });
  } });
  await assert.rejects(lab.start(), /Reset the older L2 lab/);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('up'));
});
