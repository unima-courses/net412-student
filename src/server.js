import express from 'express';
import { WebSocketServer } from 'ws';
import Docker from 'dockerode';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createArpLab } from './labs/l2-arp.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docker = new Docker(process.platform === 'win32' ? { socketPath: '//./pipe/docker_engine' } : undefined);

export async function startServer({ dataDir = process.env.NET412_DATA_DIR || path.join(os.homedir(), '.net412-lab'), labDir = path.join(root, 'lab'), port = 0 } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'config.json');
  const statePath = path.join(dataDir, 'state.json');
  const config = await fs.readFile(configPath, 'utf8').then(JSON.parse).catch(() => ({ serverUrl: 'http://127.0.0.1:8000' }));
  const state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(() => ({ drafts: {}, pending: [] }));
  const sessions = new Map();
  const packs = new Map([['l2-arp', createArpLab(labDir)]]);
  const findPack = id => packs.get(id);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== `http://127.0.0.1:${req.socket.localPort}`) return res.status(403).json({ error: 'Invalid origin' });
      if (req.get('content-type')?.split(';')[0] !== 'application/json') return res.status(415).json({ error: 'JSON required' });
    }
    next();
  });
  function session(req) {
    const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('net412_session='))?.slice(15);
    const value = sessions.get(raw);
    if (value && value.expiresAt < Date.now()) { sessions.delete(raw); return null; }
    return value;
  }
  function auth(req, res, next) {
    req.labSession = session(req);
    if (!req.labSession) return res.status(401).json({ error: 'Sign in first' });
    next();
  }
  async function saveState() {
    const temporary = statePath + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(state));
    await fs.rename(temporary, statePath);
  }
  async function remote(endpoint, token, method = 'GET', payload) {
    const response = await fetch(new URL(`/api/v1/${endpoint}`, config.serverUrl), {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || `Server returned ${response.status}`), { status: response.status });
    return data;
  }
  async function flush(token, username) {
    const remaining = [];
    for (const entry of state.pending) {
      if (entry.username !== username) { remaining.push(entry); continue; }
      try { await remote(entry.endpoint, token, 'POST', entry.payload); }
      catch (error) {
        if (error.status && error.status < 500) entry.error = error.message;
        remaining.push(entry);
      }
    }
    state.pending = remaining;
    await saveState();
    return remaining.filter(entry => entry.username === username).length;
  }
  function wrap(handler) {
    return async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };
  }
  app.get('/api/config', (req, res) => res.json({ serverUrl: config.serverUrl }));
  app.post('/api/config', wrap(async (req, res) => {
    const url = new URL(req.body.serverUrl);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      return res.status(400).json({ error: 'Use HTTPS for a remote instructor server' });
    }
    config.serverUrl = url.origin;
    await fs.writeFile(configPath, JSON.stringify(config));
    res.json(config);
  }));
  app.post('/api/login', wrap(async (req, res) => {
    const result = await remote('login/', null, 'POST', { username: req.body.username, password: req.body.password });
    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, { username: result.username, token: result.token, evidence: state.drafts[result.username] || {},
      allowedPacks: new Set(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `net412_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    await flush(result.token, result.username);
    res.json({ username: result.username, pending: state.pending.filter(entry => entry.username === result.username).length });
  }));
  app.post('/api/logout', auth, wrap(async (req, res) => {
    try { await remote('logout/', req.labSession.token, 'POST', {}); } catch { /* local sign-out always succeeds */ }
    const raw = req.headers.cookie?.match(/net412_session=([a-f0-9]+)/)?.[1];
    sessions.delete(raw);
    res.setHeader('Set-Cookie', 'net412_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  }));
  app.get('/api/me', auth, (req, res) => res.json({ username: req.labSession.username, evidence: req.labSession.evidence,
    pending: state.pending.filter(entry => entry.username === req.labSession.username).length,
    pendingErrors: state.pending.filter(entry => entry.username === req.labSession.username && entry.error).map(entry => entry.error) }));
  app.get('/api/activities', auth, wrap(async (req, res) => res.json(await remote('activities/', req.labSession.token))));
  app.get('/api/activities/:id', auth, wrap(async (req, res) => {
    const spec = await remote(`activities/${encodeURIComponent(req.params.id)}/`, req.labSession.token);
    if (findPack(spec.environment?.client_pack)) req.labSession.allowedPacks.add(spec.environment.client_pack);
    res.json(spec);
  }));
  app.get('/api/progress', auth, wrap(async (req, res) => res.json(await remote('progress/', req.labSession.token))));
  app.get('/api/lab/:pack/status', auth, wrap(async (req, res) => {
    const lab = findPack(req.params.pack);
    if (!lab) return res.status(404).json({ error: 'Lab pack unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    res.json(await lab.status());
  }));
  app.post('/api/lab/:pack/:action', auth, wrap(async (req, res) => {
    const lab = findPack(req.params.pack);
    if (!lab) return res.status(404).json({ error: 'Lab pack unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    const action = req.params.action;
    if (!['start', 'reset', 'baseline', 'poison', 'harden'].includes(action)) return res.status(404).json({ error: 'Unknown action' });
    const result = await lab[action]();
    const evidence = req.labSession.evidence;
    if (action === 'baseline') {
      evidence.baseline = result;
    } else if (action === 'poison') {
      evidence.poison = result;
    } else if (action === 'harden') {
      evidence.harden = result;
    }
    state.drafts[req.labSession.username] = evidence;
    await saveState();
    const taskId = lab.taskIds.has(req.body.task_id) ? req.body.task_id : 'l2.a';
    const payload = { action, service_ok: result.service_before ?? result.service_after ?? result.service_hardened ?? null,
      capture_seen: result.attacker_http_seen ?? null, source_test_passed: result.source_test_passed ?? null };
    const event = { id: randomUUID(), activity_id: lab.id, task_id: taskId,
      kind: action === 'start' ? 'started' : action === 'reset' ? 'reset' : 'checkpoint', payload };
    try { await remote('events/', req.labSession.token, 'POST', event); }
    catch { state.pending.push({ endpoint: 'events/', payload: event, username: req.labSession.username }); await saveState(); }
    res.json({ ...result, evidence });
  }));
  app.get('/api/lab/:pack/pcap', auth, wrap(async (req, res) => {
    const lab = findPack(req.params.pack);
    if (!lab?.exportPcap) return res.status(404).json({ error: 'PCAP unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    const target = path.join(dataDir, `arp-${randomUUID()}.pcap`);
    await lab.exportPcap(target);
    res.download(target, 'net412-l2-arp.pcap', async () => { await fs.unlink(target).catch(() => {}); });
  }));
  app.post('/api/submit', auth, wrap(async (req, res) => {
    const { activity_id, task_id, spec_version, answers } = req.body;
    const lab = findPack(activity_id);
    if (!lab || !req.labSession.allowedPacks.has(lab.id) || !Number.isInteger(spec_version) || typeof answers !== 'object' || !answers) {
      return res.status(400).json({ error: 'Invalid submission' });
    }
    const draft = req.labSession.evidence;
    const evidence = lab.evidenceFor(task_id, draft);
    const payload = { id: randomUUID(), activity_id, task_id, spec_version, answers, evidence };
    try { res.json(await remote('submissions/', req.labSession.token, 'POST', payload)); }
    catch (error) {
      if (error.status && error.status < 500) throw error;
      state.pending.push({ endpoint: 'submissions/', payload, username: req.labSession.username });
      await saveState();
      res.json({ queued: true, pending: state.pending.length });
    }
  }));
  app.post('/api/sync', auth, wrap(async (req, res) => {
    const pending = await flush(req.labSession.token, req.labSession.username);
    res.json({ pending, errors: state.pending.filter(entry => entry.username === req.labSession.username && entry.error).map(entry => entry.error) });
  }));
  app.use(express.static(path.join(root, 'web-dist')));
  app.get('*path', (req, res) => res.sendFile(path.join(root, 'web-dist', 'index.html')));
  const server = await new Promise(resolve => {
    const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (request, socket, head) => {
    const origin = request.headers.origin;
    const url = new URL(request.url, `http://127.0.0.1:${server.address().port}`);
    const target = url.searchParams.get('target');
    const lab = findPack(url.searchParams.get('pack'));
    if (origin !== `http://127.0.0.1:${server.address().port}` || url.pathname !== '/terminal' || !session(request)?.allowedPacks.has(lab?.id) || !lab?.terminalTargets.has(target)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    try {
      const execution = await docker.getContainer(lab.containerName(target)).exec({ Cmd: ['/bin/sh'], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, OpenStdin: true });
      const stream = await execution.start({ hijack: true, stdin: true });
      wss.handleUpgrade(request, socket, head, ws => {
        stream.on('data', chunk => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
        stream.on('end', () => ws.close());
        ws.on('message', raw => {
          const data = raw.toString();
          if (data.startsWith('\0')) {
            try { const size = JSON.parse(data.slice(1)); if (size.type === 'resize') execution.resize({ h: Math.min(100, Math.max(1, Number(size.rows))), w: Math.min(200, Math.max(1, Number(size.cols))) }); } catch { /* ignore invalid resize */ }
          } else stream.write(raw);
        });
        ws.on('close', () => stream.end());
      });
    } catch { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.NET412_PORT || 4174);
  startServer({ port }).then(server => console.log(`NET412 Lab at http://127.0.0.1:${server.address().port}`));
}
