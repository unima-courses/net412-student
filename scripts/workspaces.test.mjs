import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tar from 'tar-stream';
import { unzipSync, strFromU8 } from 'fflate';
import { exportWorkspaces, workspaceFilename } from '../src/workspaces.js';

function archive(entries) {
  const pack = tar.pack();
  for (const [name, content, type = 'file'] of entries) pack.entry({ name, type, ...(type === 'symlink' ? { linkname: content } : {}) }, type === 'file' ? content : '');
  pack.finalize(); return pack;
}
test('exports every container with binary, hidden, nested and empty entries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-export-test-'));
  try {
    const inspected = [];
    const docker = { getContainer: name => ({
      inspect: async () => ({ Config: { WorkingDir: name === 'lab-router-1' ? '/home/student' : '/work' } }),
      getArchive: async ({ path: source }) => { inspected.push([name, source]); return archive([
        ['.', '', 'directory'], ['.hidden', 'secret work'], ['nested', '', 'directory'],
        ['nested/evidence.pcap', Buffer.from([0, 255, 10, 0])], ['empty', '', 'directory'], ['shortcut', '/etc/passwd', 'symlink'],
      ]); },
    }) };
    const destination = path.join(directory, 'work.zip');
    await exportWorkspaces({ docker, lab: { containerName: name => `lab-${name}-1` }, targets: ['host_a', 'router'], destination });
    const entries = unzipSync(await fs.readFile(destination));
    assert.deepEqual(inspected, [['lab-host_a-1', '/work/.'], ['lab-router-1', '/home/student/.']]);
    for (const target of ['host_a', 'router']) {
      assert.equal(strFromU8(entries[`${target}/.hidden`]), 'secret work');
      assert.deepEqual([...entries[`${target}/nested/evidence.pcap`]], [0, 255, 10, 0]);
      assert.ok(entries[`${target}/empty/`]);
      assert.match(strFromU8(entries[`${target}/shortcut.link.txt`]), /\/etc\/passwd/);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('rejects traversal entries and does not write files outside the archive', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-export-unsafe-'));
  try {
    const docker = { getContainer: () => ({ inspect: async () => ({ Config: { WorkingDir: '/work' } }), getArchive: async () => archive([['../escape', 'bad']]) }) };
    await assert.rejects(exportWorkspaces({ docker, lab: { containerName: n => n }, targets: ['host_a'], destination: path.join(directory, 'work.zip') }), /unsafe file path/);
    await assert.rejects(fs.stat(path.join(directory, 'escape')), /ENOENT/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('does not silently omit a missing container workspace', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-export-missing-'));
  try {
    const docker = { getContainer: () => ({ inspect: async () => ({ Config: {} }), getArchive: async () => { throw new Error('missing'); } }) };
    await assert.rejects(exportWorkspaces({ docker, lab: { containerName: n => n }, targets: ['host_a'], destination: path.join(directory, 'work.zip') }), /host_a's work directory/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('uses the student and task in a safe ZIP filename', () => {
  assert.equal(workspaceFilename('student42', 'l2.a'), 'student42_l2.a.zip');
  assert.equal(workspaceFilename('../student\r\n', 'l2/a'), '-student--_l2-a.zip');
});
