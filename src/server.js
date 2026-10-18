import express from 'express';
import { WebSocketServer } from 'ws';
import Docker from 'dockerode';
import { randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { materializeBundle } from './bundles.js';
import { exportWorkspaces, workspaceFilename } from './workspaces.js';
import { createComposeLab } from './labs/compose.js';
import { createArpLab } from './labs/l2-arp.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docker = new Docker(process.platform === 'win32' ? { socketPath: '//./pipe/docker_engine' } : undefined);

export async function startServer({ dataDir = process.env.NET412_DATA_DIR || path.join(os.homedir(), '.net412-lab'), port = 0 } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const packsDir = path.join(dataDir, 'packs');
  const configPath = path.join(dataDir, 'config.json');
  const statePath = path.join(dataDir, 'state.json');
  const config = await fs.readFile(configPath, 'utf8').then(JSON.parse).catch(() => ({ serverUrl: process.env.NET412_INSTRUCTOR_URL || 'http://127.0.0.1:8000' }));
  const state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(() => ({ drafts: {}, pending: [] }));
  const sessions = new Map();
  const packFactories = new Map([['compose', createComposeLab], ['l2-arp', createArpLab]]);
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
  async function auth(req, res, next) {
    req.labSession = session(req);
    if (!req.labSession) return res.status(401).json({ error: 'Sign in first' });
    if (req.path === '/api/logout') return next();
    try {
      const me = await remote('me/', req.labSession.token);
      req.labSession.passwordChangeRequired = Boolean(me.password_change_required);
      if (req.labSession.passwordChangeRequired && !['/api/me', '/api/password/change'].includes(req.path)) {
        return res.status(403).json({ error: 'Change your password before accessing activities.', password_change_required: true });
      }
      next();
    } catch (error) { res.status(error.status || 503).json({ error: error.message }); }
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
    if (!response.ok) throw Object.assign(new Error(data.error || `Server returned ${response.status}`), { status: response.status, passwordChangeRequired: Boolean(data.password_change_required) });
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
    return async (req, res) => { try { await handler(req, res); } catch (error) { if (res.headersSent) res.destroy(error); else res.status(error.status || 500).json({ error: error.message, password_change_required: error.passwordChangeRequired || undefined }); } };
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
    sessions.set(sid, { username: result.username, token: result.token, passwordChangeRequired: Boolean(result.password_change_required), evidence: state.drafts[result.username] || {},
      allowedPacks: new Set(), packs: new Map(), activityPacks: new Map(), activitySpecs: new Map(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    res.setHeader('Set-Cookie', `net412_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    if (!result.password_change_required) await flush(result.token, result.username);
    res.json({ username: result.username, password_change_required: Boolean(result.password_change_required), pending: state.pending.filter(entry => entry.username === result.username).length });
  }));
  app.post('/api/logout', auth, wrap(async (req, res) => {
    try { await remote('logout/', req.labSession.token, 'POST', {}); } catch { /* local sign-out always succeeds */ }
    const raw = req.headers.cookie?.match(/net412_session=([a-f0-9]+)/)?.[1];
    sessions.delete(raw);
    res.setHeader('Set-Cookie', 'net412_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  }));
  app.get('/api/me', auth, (req, res) => res.json({ username: req.labSession.username, password_change_required: req.labSession.passwordChangeRequired, evidence: req.labSession.evidence,
    pending: state.pending.filter(entry => entry.username === req.labSession.username).length,
    pendingErrors: state.pending.filter(entry => entry.username === req.labSession.username && entry.error).map(entry => entry.error) }));
  app.post('/api/password/change', auth, wrap(async (req, res) => {
    const result = await remote('password/change/', req.labSession.token, 'POST', req.body);
    req.labSession.token = result.token;
    req.labSession.passwordChangeRequired = false;
    await flush(result.token, req.labSession.username);
    res.json({ ok: true, password_change_required: false });
  }));
  app.get('/api/activities', auth, wrap(async (req, res) => res.json(await remote('activities/', req.labSession.token))));
  app.get('/api/activities/:id', auth, wrap(async (req, res) => {
    const spec = await remote(`activities/${encodeURIComponent(req.params.id)}/`, req.labSession.token);
    const packId = spec.environment?.client_pack;
    const factory = packFactories.get(packId);
    if (!factory) return res.status(409).json({ error: `This client does not support lab pack ${packId || '(missing)'}` });
    const bundle = await remote(`activities/${encodeURIComponent(req.params.id)}/bundle/`, req.labSession.token);
    if (bundle.activity_id !== spec.id || bundle.version !== spec.version || bundle.digest !== spec.environment?.bundle?.digest) {
      return res.status(502).json({ error: 'Instructor server returned mismatched activity and lab bundle versions' });
    }
    // Pull the common material first; initialize a stable personal challenge before build.
    const initialized = packId === 'l2-arp'
      ? await remote(`activities/${encodeURIComponent(spec.id)}/initialize/`, req.labSession.token, 'POST', {}) : bundle;
    if (initialized.activity_id !== spec.id || initialized.version !== spec.version) throw new Error('Initialization mismatch');
    const installed = await materializeBundle(initialized, packsDir);
    const lab = factory(installed.directory, spec);
    req.labSession.packs.set(packId, lab);
    req.labSession.activityPacks.set(spec.id, lab);
    req.labSession.activitySpecs.set(spec.id, spec);
    req.labSession.allowedPacks.add(packId);
    spec.local_bundle = { digest: installed.digest, cached: installed.cached };
    res.json(spec);
  }));
  app.get('/api/activities/:id/work.zip', auth, wrap(async (req, res) => {
    const lab = req.labSession.activityPacks.get(req.params.id);
    const spec = req.labSession.activitySpecs.get(req.params.id);
    const task = req.query.task;
    if (!lab || !spec || !lab.taskIds.has(task)) return res.status(404).json({ error: 'Open an assigned activity and select a valid task first' });
    if (!(await lab.status()).running) return res.status(409).json({ error: 'Start the current lab before downloading your work' });
    const devices = Array.isArray(spec.topology) ? spec.topology : spec.topology?.devices;
    const targets = [...new Set(devices?.map(device => device.name) || [...lab.terminalTargets])];
    const temporary = await fs.mkdtemp(path.join(dataDir, 'work-export-'));
    const target = path.join(temporary, 'work.zip');
    try {
      await exportWorkspaces({ docker, lab, targets, destination: target, directories: spec.environment.work_directories || {} });
      res.setHeader('Cache-Control', 'no-store');
      await new Promise((resolve, reject) => res.download(target, workspaceFilename(req.labSession.username, task), error => error ? reject(error) : resolve()));
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }));
  app.get('/api/progress', auth, wrap(async (req, res) => res.json(await remote('progress/', req.labSession.token))));
  app.get('/api/lab/:pack/status', auth, wrap(async (req, res) => {
    const lab = req.labSession.packs.get(req.params.pack);
    if (!lab) return res.status(404).json({ error: 'Lab pack unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    const status = await lab.status();
    if (status.running && lab.groundTruth) {
      await remote(`activities/${lab.id}/ground-truth/`, req.labSession.token, 'POST', await lab.groundTruth());
    }
    res.json(status);
  }));
  app.post('/api/lab/:pack/:action', auth, wrap(async (req, res) => {
    const lab = req.labSession.packs.get(req.params.pack);
    if (!lab) return res.status(404).json({ error: 'Lab pack unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    const action = req.params.action;
    if (!lab.actions.has(action) || typeof lab[action] !== 'function') return res.status(404).json({ error: 'Unknown action' });
    const result = await lab[action]();
    if (action === 'start' && lab.groundTruth) {
      await remote(`activities/${lab.id}/ground-truth/`, req.labSession.token, 'POST', await lab.groundTruth());
    }
    const evidence = req.labSession.evidence;
    if (action === 'reset') {
      delete evidence.poison;
      delete evidence.harden;
    }
    state.drafts[req.labSession.username] = evidence;
    await saveState();
    const taskId = lab.taskIds.has(req.body.task_id) ? req.body.task_id : lab.taskIds.values().next().value;
    const payload = { action };
    const event = { id: randomUUID(), activity_id: lab.id, task_id: taskId,
      kind: action === 'start' ? 'started' : action === 'reset' ? 'reset' : 'checkpoint', payload };
    try { await remote('events/', req.labSession.token, 'POST', event); }
    catch { state.pending.push({ endpoint: 'events/', payload: event, username: req.labSession.username }); await saveState(); }
    res.json({ ...result, evidence });
  }));
  app.get('/api/lab/:pack/pcap', auth, wrap(async (req, res) => {
    const lab = req.labSession.packs.get(req.params.pack);
    if (!lab?.exportPcap) return res.status(404).json({ error: 'PCAP unavailable' });
    if (!req.labSession.allowedPacks.has(lab.id)) return res.status(403).json({ error: 'Open the published activity first' });
    const target = path.join(dataDir, `arp-${randomUUID()}.pcap`);
    try {
      await lab.exportPcap(target);
      const capture = await fs.readFile(target);
      res.setHeader('Content-Type', 'application/vnd.tcpdump.pcap');
      res.setHeader('Content-Disposition', 'attachment; filename="net412-l2-arp.pcap"');
      res.setHeader('Content-Length', capture.length);
      res.send(capture);
    } finally {
      await fs.unlink(target).catch(() => {});
    }
  }));
  app.post('/api/submit', auth, wrap(async (req, res) => {
    const { activity_id, task_id, spec_version, answers } = req.body;
    const lab = req.labSession.activityPacks.get(activity_id);
    if (!lab || !req.labSession.allowedPacks.has(lab.id) || !Number.isInteger(spec_version) || typeof answers !== 'object' || !answers) {
      return res.status(400).json({ error: 'Invalid submission' });
    }
    if (lab.groundTruth) {
      if (!(await lab.status()).running) return res.status(409).json({ error: 'Start the lab before submitting' });
      await remote(`activities/${lab.id}/ground-truth/`, req.labSession.token, 'POST', await lab.groundTruth());
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
    const dimension = (value, fallback, maximum) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
    };
    const rows = dimension(url.searchParams.get('rows'), 24, 100);
    const cols = dimension(url.searchParams.get('cols'), 80, 240);
    const clientSession = session(request);
    const lab = clientSession?.packs.get(url.searchParams.get('pack'));
    let passwordReady = false;
    if (clientSession) {
      try { passwordReady = !(await remote('me/', clientSession.token)).password_change_required; }
      catch { /* expired or reset sessions cannot open container shells */ }
    }
    if (origin !== `http://127.0.0.1:${server.address().port}` || url.pathname !== '/terminal' || !passwordReady || !clientSession?.allowedPacks.has(lab?.id) || !lab?.terminalTargets.has(target)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    try {
      const execution = await docker.getContainer(lab.containerName(target)).exec({
        Cmd: ['/bin/sh'], Env: ['TERM=xterm-256color', 'COLORTERM=truecolor', 'LANG=C.UTF-8'],
        AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, OpenStdin: true,
        ConsoleSize: [rows, cols]
      });
      const stream = await execution.start({ hijack: true, stdin: true, Tty: true });
      await execution.resize({ h: rows, w: cols });
      wss.handleUpgrade(request, socket, head, ws => {
        stream.on('data', chunk => { if (ws.readyState === 1) ws.send(chunk, { binary: true }); });
        stream.on('end', () => ws.close());
        stream.on('error', () => { if (ws.readyState === 1) ws.close(1011, 'Terminal stream failed'); });
        ws.on('message', (raw, isBinary) => {
          const data = isBinary ? null : raw.toString();
          if (data?.startsWith('\0')) {
            try {
              const size = JSON.parse(data.slice(1));
              if (size.type === 'resize') {
                execution.resize({ h: dimension(size.rows, rows, 100), w: dimension(size.cols, cols, 240) }).catch(() => {});
              }
            } catch { /* ignore invalid resize */ }
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
  startServer({ port }).then(server => console.log(`Open NET412 Lab in your browser: http://127.0.0.1:${server.address().port}`));
}
