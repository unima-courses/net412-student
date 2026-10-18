import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { startServer } from '../src/server.js';

const exec = promisify(execFile);
const entrypoint = fileURLToPath(new URL('../src/server.js', import.meta.url));

async function temporaryData(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-startup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function occupyPort(t) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return server.address().port;
}

test('startup returns only after its loopback HTTP listener is ready', async t => {
  const dataDir = await temporaryData(t);
  const server = await startServer({ dataDir, port: 0 });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  assert.equal(server.listening, true);
  assert.equal(server.address().address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config`);
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).serverUrl, 'string');
});

test('startup rejects the bind error when another server owns the port', async t => {
  const port = await occupyPort(t);
  const dataDir = await temporaryData(t);
  await assert.rejects(startServer({ dataDir, port }), { code: 'EADDRINUSE' });
});

test('the CLI exits with a useful occupied-port message instead of a null-address exception', async t => {
  const port = await occupyPort(t);
  const dataDir = await temporaryData(t);
  await assert.rejects(exec(process.execPath, [entrypoint], {
    env: { ...process.env, NET412_PORT: String(port), NET412_DATA_DIR: dataDir },
    timeout: 10000,
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, new RegExp(`Port ${port} is already in use`));
    assert.match(error.stderr, /NET412_PORT/);
    assert.doesNotMatch(error.stderr, /TypeError|Cannot read properties/);
    assert.doesNotMatch(error.stdout, /Open NET412 Lab/);
    return true;
  });
});
