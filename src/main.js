import './style.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const app = document.querySelector('#app');
const state = { user: null, activities: [], spec: null, task: 'l2.a', evidence: {}, running: false,
  target: 'victim', terminal: null, socket: null, observer: null, message: '', progress: [], pending: 0, pendingErrors: [] };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const theme = localStorage.getItem('net412-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'corporate');
document.documentElement.dataset.theme = theme;

async function api(url, method = 'GET', payload) {
  const response = await fetch(`/api/${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function notify(message) { state.message = message; render(); }
function button(label, action, style = 'btn-outline', disabled = false) {
  return `<button class="btn ${style} btn-sm" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function layout(content) {
  app.innerHTML = `<div class="min-h-screen bg-base-200 text-base-content">
    <header class="navbar bg-base-100 border-b border-base-300 px-4 lg:px-8 gap-3">
      <div class="flex-1"><span class="font-bold text-xl">NET412 Lab</span><span class="badge badge-ghost ml-3 hidden sm:inline-flex">2026</span></div>
      <span class="text-sm hidden md:inline">${escapeHtml(state.user || 'Sign in to continue')}</span>
      ${button('Theme', 'theme', 'btn-ghost')}${state.user ? button('Sign out', 'logout', 'btn-ghost') : ''}
    </header><main class="max-w-7xl mx-auto p-4 lg:p-8">${state.message ? `<div role="status" class="alert alert-info mb-5">${escapeHtml(state.message)}</div>` : ''}${content}</main></div>`;
}
function renderLogin(config) {
  layout(`<div class="max-w-xl mx-auto mt-8"><div class="card bg-base-100 shadow-sm"><div class="card-body gap-4">
    <div><p class="text-sm uppercase tracking-wide text-primary font-semibold">Student client</p><h1 class="text-3xl font-semibold">Sign in to NET412</h1><p class="text-base-content/70 mt-2">Labs run in isolated Docker containers on this computer. The instructor server stores tasks, progress and grades.</p></div>
    <form id="login-form" class="space-y-4"><label class="block"><span class="label">Username</span><input name="username" class="input input-bordered w-full" autocomplete="username" required></label><label class="block"><span class="label">Password</span><input type="password" name="password" class="input input-bordered w-full" autocomplete="current-password" required></label><button class="btn btn-primary w-full">Sign in</button></form>
    <details class="border-t border-base-300 pt-4"><summary class="cursor-pointer font-medium">Instructor server settings</summary><form id="config-form" class="mt-4 flex gap-2"><input name="serverUrl" aria-label="Instructor server URL" class="input input-bordered flex-1" value="${escapeHtml(config.serverUrl)}" required><button class="btn btn-outline">Save</button></form><p class="text-sm text-base-content/70 mt-2">Use HTTPS for a remote server. Local testing can use http://127.0.0.1:8000.</p></details>
  </div></div></div>`);
}
function renderDashboard() {
  const cards = state.activities.map(item => `<button class="card bg-base-100 shadow-sm text-left hover:border-primary border border-transparent" data-open="${escapeHtml(item.id)}"><span class="card-body"><span class="card-title">${escapeHtml(item.title)}</span><span class="text-base-content/70">${escapeHtml(item.summary)}</span><span class="badge badge-primary badge-outline mt-2">Version ${item.version}</span></span></button>`).join('');
  const rows = state.progress.map(item => `<tr><td>${escapeHtml(item.task_id)}</td><td>${item.grading.provisional_passes}/${item.grading.possible}</td><td>${item.instructor_score == null ? 'Review pending' : escapeHtml(item.instructor_score)}</td><td>${escapeHtml(item.created_at.slice(0, 10))}</td></tr>`).join('');
  layout(`<div class="flex flex-wrap justify-between gap-3 items-center"><div><h1 class="text-3xl font-semibold">Your activities</h1><p class="text-base-content/70">Choose an activity to open its workbook and local lab.</p></div>${button(`Sync pending (${state.pending})`, 'sync', 'btn-outline')}</div>
    ${state.pendingErrors.length ? `<div class="alert alert-warning mt-4">${state.pendingErrors.map(escapeHtml).join('; ')}</div>` : ''}
    <div class="grid md:grid-cols-2 gap-4 mt-6">${cards || '<div class="alert">No activities are published yet. Ask your instructor when the lab opens.</div>'}</div>
    <section class="card bg-base-100 shadow-sm mt-8"><div class="card-body"><h2 class="card-title">Recent progress</h2><div class="overflow-x-auto"><table class="table"><thead><tr><th>Task</th><th>Provisional checks</th><th>Instructor grade</th><th>Date</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No submissions yet.</td></tr>'}</tbody></table></div></div></section>`);
}
function renderTask() {
  const spec = state.spec;
  const task = spec.tasks.find(item => item.id === state.task) || spec.tasks[0];
  const evidence = state.evidence;
  const pack = spec.environment.client_pack;
  const actions = spec.environment.actions || [];
  const targets = spec.environment.terminal_targets || [];
  const taskTabs = spec.tasks.map(item => `<button class="tab ${item.id === task.id ? 'tab-active' : ''}" role="tab" aria-selected="${item.id === task.id}" data-task="${escapeHtml(item.id)}">${escapeHtml(item.id.toUpperCase())}</button>`).join('');
  const fields = task.answers.map(item => `<label class="block mt-4"><span class="label font-medium">${escapeHtml(item.label)}</span>${item.type === 'paragraph' ? `<textarea name="${escapeHtml(item.key)}" class="textarea textarea-bordered w-full min-h-28" required></textarea>` : `<input name="${escapeHtml(item.key)}" class="input input-bordered w-full" required>`}</label>`).join('');
  const observations = [['Baseline', evidence.baseline?.neighbour], ['After forged replies', evidence.poison?.neighbour], ['After hardening', evidence.harden?.neighbour], ['Scaffold ran', evidence.poison?.source_test_passed == null ? null : String(evidence.poison.source_test_passed)], ['Attacker capture saw HTTP request', evidence.poison?.attacker_http_seen == null ? null : String(evidence.poison.attacker_http_seen)], ['Legitimate service after attack', evidence.poison?.service_after == null ? null : String(evidence.poison.service_after)]];
  layout(`<div class="breadcrumbs text-sm mb-4"><ul><li><button data-action="back">Activities</button></li><li>${escapeHtml(spec.id.toUpperCase())}</li></ul></div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.95fr)] gap-6"><div class="space-y-5">
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><p class="text-sm text-primary font-semibold">${escapeHtml(spec.window)}</p><h1 class="card-title text-2xl">${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.summary)}</p><p class="text-sm text-base-content/70">${escapeHtml(spec.safety)}</p><div class="flex flex-wrap gap-2 mt-2">${spec.topology.map(host => `<span class="badge badge-outline">${escapeHtml(host.name)} · ${escapeHtml(host.ip)}</span>`).join('')}</div></div></section>
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="tabs tabs-border" role="tablist">${taskTabs}</div><h2 class="card-title mt-3">${escapeHtml(task.title)}</h2><p class="text-sm text-base-content/70">About ${task.time_minutes} minutes · ${escapeHtml(task.mode)}</p><ol class="list-decimal pl-6 space-y-2">${task.instructions.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol><div class="divider my-1"></div><p class="font-semibold">Evidence to keep</p><ul class="list-disc pl-6">${task.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="text-sm"><strong>Success:</strong> ${escapeHtml(task.success_criteria)}</p><p class="text-sm text-base-content/70 mt-2">${escapeHtml(task.reset)}</p></div></section>
      ${task.reference_evidence ? `<section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Supplied evidence</h2><p>${escapeHtml(task.reference_evidence)}</p></div></section>` : ''}
      ${task.solution ? `<section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Released walkthrough</h2><p>${escapeHtml(task.solution)}</p></div></section>` : ''}
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Submit for provisional checks</h2><p class="text-sm text-base-content/70">Client observations are evidence for instructor review. Export the PCAP for Wireshark before resetting if you need it.</p><form id="submit-form" data-task="${escapeHtml(task.id)}">${fields}<button class="btn btn-primary mt-5">Submit task</button></form></div></section>
    </div><div class="space-y-5">
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="flex justify-between items-center"><h2 class="card-title">Local lab</h2><span class="badge ${state.running ? 'badge-success' : 'badge-ghost'}">${state.running ? 'Running' : 'Stopped'}</span></div><p class="text-sm text-base-content/70">All three containers share one isolated Docker network. Start once; reset removes it.</p><div class="flex flex-wrap gap-2 mt-2">${actions.map(item => button(escapeHtml(item.label), escapeHtml(item.id), item.id === 'start' ? 'btn-primary' : item.id === 'reset' ? 'btn-error btn-outline' : 'btn-outline', item.id === 'start' ? state.running : !state.running)).join('')}</div><a class="link link-primary text-sm mt-2" href="/api/lab/${escapeHtml(pack)}/pcap" download>Export attacker PCAP for Wireshark</a></div></section>
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Observations</h2><dl class="text-sm space-y-2">${observations.map(([label, value]) => `<div class="border-b border-base-300 pb-2"><dt class="font-medium">${escapeHtml(label)}</dt><dd class="font-mono break-all">${escapeHtml(value ?? 'Run the relevant action')}</dd></div>`).join('')}</dl><pre class="log text-xs bg-base-200 p-3 rounded-lg mt-3">${escapeHtml(evidence.poison?.capturePreview || 'Capture preview appears after the bounded ARP attempt.')}</pre></div></section>
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="flex justify-between items-center"><h2 class="card-title">Container terminal</h2><select id="target" class="select select-bordered select-sm" aria-label="Terminal target">${targets.map(name => `<option value="${escapeHtml(name)}" ${state.target === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div><p class="text-sm text-base-content/70">Shell access is confined to the selected disposable container. Use Ctrl+C to stop a command.</p><div id="terminal" class="terminal-frame" aria-label="Container terminal"></div></div></section>
    </div></div>`);
  connectTerminal();
}
function render() {
  state.observer?.disconnect(); state.observer = null;
  state.socket?.close(); state.socket = null; state.terminal?.dispose(); state.terminal = null;
  if (!state.user) api('config').then(renderLogin).catch(error => layout(`<p class="alert alert-error">${escapeHtml(error.message)}</p>`));
  else if (!state.spec) renderDashboard(); else renderTask();
}
function connectTerminal() {
  if (!state.running) { document.querySelector('#terminal').textContent = 'Start the lab to open a shell.'; return; }
  const terminal = new Terminal({ cursorBlink: true, fontFamily: 'ui-monospace, monospace', fontSize: 13,
    theme: { background: '#111827', foreground: '#e5e7eb' } });
  const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(document.querySelector('#terminal')); fit.fit();
  state.terminal = terminal;
  const socket = new WebSocket(`ws://127.0.0.1:${location.port}/terminal?pack=${encodeURIComponent(state.spec.environment.client_pack)}&target=${state.target}`);
  socket.binaryType = 'arraybuffer'; state.socket = socket;
  socket.onopen = () => socket.send(`\0${JSON.stringify({ type: 'resize', rows: terminal.rows, cols: terminal.cols })}`);
  socket.onmessage = event => terminal.write(new Uint8Array(event.data));
  socket.onclose = () => terminal.write('\r\n[Terminal disconnected]\r\n');
  terminal.onData(data => { if (socket.readyState === WebSocket.OPEN) socket.send(data); });
  state.observer = new ResizeObserver(() => { fit.fit(); if (socket.readyState === WebSocket.OPEN) socket.send(`\0${JSON.stringify({ type: 'resize', rows: terminal.rows, cols: terminal.cols })}`); });
  state.observer.observe(document.querySelector('#terminal'));
}
async function refresh() {
  const me = await api('me'); state.user = me.username; state.evidence = me.evidence; state.pending = me.pending; state.pendingErrors = me.pendingErrors || [];
  [state.activities, state.progress] = await Promise.all([
    api('activities').then(data => data.activities), api('progress').then(data => data.submissions)]);
  if (state.spec) state.running = (await api(`lab/${state.spec.environment.client_pack}/status`)).running;
  render();
}
app.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'config-form') { await api('config', 'POST', data); notify('Instructor server URL saved.'); }
    if (form.id === 'login-form') { await api('login', 'POST', data); await refresh(); }
    if (form.id === 'submit-form') {
      const result = await api('submit', 'POST', { activity_id: state.spec.id, task_id: form.dataset.task, spec_version: state.spec.version, answers: data });
      notify(result.queued ? 'Submission saved locally and queued for sync.' : `Submitted. ${result.grading.provisional_passes}/${result.grading.possible} provisional checks passed; instructor review remains.`);
    }
  } catch (error) { notify(error.message); }
});
app.addEventListener('click', async event => {
  const opened = event.target.closest('[data-open]');
  const task = event.target.closest('[role=tab][data-task]');
  const action = event.target.closest('[data-action]')?.dataset.action;
  try {
    if (opened) { state.spec = await api(`activities/${opened.dataset.open}`); state.task = state.spec.tasks[0].id; state.running = (await api(`lab/${state.spec.environment.client_pack}/status`)).running; state.message = ''; render(); }
    else if (task) { state.task = task.dataset.task; render(); }
    else if (action === 'theme') { const next = document.documentElement.dataset.theme === 'dark' ? 'corporate' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('net412-theme', next); }
    else if (action === 'back') { state.spec = null; await refresh(); }
    else if (action === 'logout') { await api('logout', 'POST', {}); state.user = null; state.spec = null; render(); }
    else if (action === 'sync') { const result = await api('sync', 'POST', {}); state.pending = result.pending; state.pendingErrors = result.errors || []; notify(`${result.pending} item(s) still pending.${state.pendingErrors.length ? ' Check the sync errors below.' : ''}`); }
    else if (['start', 'reset', 'baseline', 'poison', 'harden'].includes(action)) {
      state.message = `${action[0].toUpperCase()}${action.slice(1)} in progress…`; render();
      const result = await api(`lab/${state.spec.environment.client_pack}/${action}`, 'POST', { task_id: state.task });
      if (action === 'start') state.running = true;
      if (action === 'reset') state.running = false;
      state.evidence = result.evidence;
      notify(result.message || `${action} completed. Review the observations.`);
    }
  } catch (error) { notify(error.message); }
});
app.addEventListener('change', event => { if (event.target.id === 'target') { state.target = event.target.value; render(); } });
refresh().catch(() => render());
