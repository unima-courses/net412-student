import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposeLab } from '../src/labs/compose.js';

const spec = {
  id: 'shell-practice',
  environment: { client_pack: 'compose', compose_project: 'net412-shell', terminal_targets: ['student', 'service'] },
  tasks: [{ id: 'shell.a' }],
};

test('creates a generic assigned Compose pack from the activity specification', () => {
  const lab = createComposeLab('/tmp/example-lab', spec);
  assert.equal(lab.id, 'compose');
  assert.deepEqual([...lab.actions], ['start', 'reset']);
  assert.equal(lab.containerName('student'), 'net412-shell-student-1');
  assert.deepEqual(lab.evidenceFor('shell.a'), {});
  assert.throws(() => lab.evidenceFor('missing'), /Unknown task/);
});

test('rejects unsafe Compose project and terminal names', () => {
  assert.throws(() => createComposeLab('/tmp/example-lab', {
    ...spec, environment: { ...spec.environment, compose_project: '../escape' },
  }), /invalid project name/);
});

test('exports only the configured capture without starting traffic', async () => {
  const calls = [];
  const configured = { ...spec, environment: { ...spec.environment, capture: {target: 'student', path: '/work/attack.pcap'} } };
  const lab = createComposeLab('/tmp/example-lab', configured, { runDocker: async args => { calls.push(args); return ''; } });
  await lab.exportPcap('/tmp/download.pcap');
  assert.deepEqual(calls, [
    ['exec', 'net412-shell-student-1', 'tcpdump', '-nn', '-r', '/work/attack.pcap', '-c', '1'],
    ['cp', 'net412-shell-student-1:/work/attack.pcap', '/tmp/download.pcap'],
  ]);
  assert.equal(createComposeLab('/tmp/example-lab', spec).exportPcap, undefined);
  for (const capture of [{target:'missing', path:'/work/a.pcap'}, {target:'student', path:'/work/../a.pcap'}, {target:'student', path:'/etc/a.pcap'}]) {
    assert.throws(() => createComposeLab('/tmp/example-lab', {...spec, environment:{...spec.environment, capture}}), /Capture must/);
  }
});

test('missing capture produces an actionable error and never copies a file', async () => {
  const calls = [];
  const lab = createComposeLab('/tmp/example-lab', {...spec, environment:{...spec.environment, capture:{target:'student',path:'/work/attack.pcap'}}}, {
    runDocker: async args => { calls.push(args); throw new Error('missing'); },
  });
  await assert.rejects(lab.exportPcap('/tmp/download.pcap'), error => error.status === 409 && /Start tcpdump/.test(error.message));
  assert.equal(calls.length, 1);
});

test('running containers from another bundle are not treated as this lab', async () => {
  const lab = createComposeLab('/tmp/example-lab', spec, {runDocker: async args =>
    args[0] === 'inspect' ? '/tmp/other-student\n/tmp/other-student' : 'student\nservice'});
  assert.equal((await lab.status()).running, false);
});
