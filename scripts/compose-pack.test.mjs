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
