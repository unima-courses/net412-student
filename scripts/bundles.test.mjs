import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { materializeBundle } from '../src/bundles.js';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
function fixture(files) {
  const activity_id = 'test-lab';
  const version = 3;
  const manifest = Object.keys(files).sort().map(name => `${name}\0${sha256(files[name])}\0`).join('');
  return { activity_id, version, files, digest: sha256(`${activity_id}\0${version}\0${manifest}`) };
}

test('materializes and reuses a verified instructor bundle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-bundle-test-'));
  try {
    const bundle = fixture({ Dockerfile: 'FROM alpine:3.21\n', 'compose.yaml': 'services: {}\n', 'src/task.txt': 'work\n' });
    const first = await materializeBundle(bundle, root);
    assert.equal(first.cached, false);
    assert.equal(await fs.readFile(path.join(first.directory, 'Dockerfile'), 'utf8'), bundle.files.Dockerfile);
    assert.equal(await fs.readFile(path.join(first.directory, 'src/task.txt'), 'utf8'), 'work\n');
    const second = await materializeBundle(bundle, root);
    assert.equal(second.cached, true);
    assert.equal(second.directory, first.directory);
    await fs.writeFile(path.join(first.directory, 'Dockerfile'), 'FROM busybox\n');
    const repaired = await materializeBundle(bundle, root);
    assert.equal(repaired.cached, false);
    assert.equal(await fs.readFile(path.join(repaired.directory, 'Dockerfile'), 'utf8'), bundle.files.Dockerfile);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects tampering and paths outside the pack directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-bundle-test-'));
  try {
    const tampered = fixture({ Dockerfile: 'FROM alpine:3.21\n', 'compose.yaml': 'services: {}\n' });
    tampered.files.Dockerfile = 'FROM busybox\n';
    await assert.rejects(materializeBundle(tampered, root), /digest verification failed/);
    const traversal = fixture({ Dockerfile: 'FROM alpine:3.21\n', 'compose.yaml': 'services: {}\n', '../escape': 'bad' });
    await assert.rejects(materializeBundle(traversal, root), /unsafe path/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
