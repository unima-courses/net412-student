import './style.css';
import './topology/topology.css';
import { renderTopology, topologyModel } from './topology/index.js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const app = document.querySelector('#app');
const state = { regNumber: '', opening: null, submitting: false, user: null, passwordChangeRequired: false, activities: [], spec: null, task: 'l2.a', evidence: {}, running: false,
  target: null, sessions: new Map(), activeSession: null, sessionCounts: {}, summary: { tasks: [] }, drafts: {}, message: '', downloading: false, progress: [], pending: 0, pendingErrors: [] };
const activityCache = new Map();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let theme = 'corporate';
try { if (localStorage.getItem('net412-theme') === 'dark') theme = 'dark'; } catch { /* use the default when storage is unavailable */ }
document.documentElement.dataset.theme = theme;

async function api(url, method = 'GET', payload) {
  const response = await fetch(`/api/${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const data = await response.json();
  if (!response.ok) {
    if (data.password_change_required) { state.passwordChangeRequired = true; state.spec = null; closeTerminals(); }
    if (response.status === 401 && state.user) { state.user = null; state.spec = null; state.drafts = {}; activityCache.clear(); closeTerminals(); }
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}
function notify(message) { state.message = message; render(); }
function button(label, action, style = 'btn-outline', disabled = false) {
  return `<button class="btn ${style} btn-sm" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function renderCommands(task) {
  if (!task.commands?.length) return '';
  return `<div class="command-guide"><h3>Commands to run</h3><p>Choose the named terminal, type these commands, and read their output before continuing.</p>${task.commands.map(group => `<section class="command-group"><header><span>${escapeHtml(group.label)}</span><code>${escapeHtml(group.target)}</code></header>${group.note ? `<p>${escapeHtml(group.note)}</p>` : ''}<pre>${group.lines.map(escapeHtml).join('\n')}</pre></section>`).join('')}</div>`;
}
function layout(content) {
  rememberAnswers();
  for (const session of state.sessions.values()) session.element.remove();
  app.innerHTML = `<div class="min-h-screen bg-base-200 text-base-content">
    <header class="navbar bg-base-100 border-b border-base-300 px-4 lg:px-8 gap-3">
      <div class="flex-1"><span class="font-bold text-xl">NET412 Lab</span><span class="badge badge-ghost ml-3 hidden sm:inline-flex">2026</span></div>
      <span class="text-sm hidden md:inline">${escapeHtml(state.user || 'Sign in to continue')}</span>
      ${button('Theme', 'theme', 'btn-ghost')}${state.user ? button('Reset password', 'reset-password', 'btn-ghost') + button('Sign out', 'logout', 'btn-ghost') : ''}
    </header><main class="max-w-7xl mx-auto p-4 lg:p-8">${state.message ? `<div role="status" class="alert alert-info mb-5">${escapeHtml(state.message)}</div>` : ''}${content}</main></div>`;
}
function renderLogin(config) {
  layout(`<div class="max-w-xl mx-auto mt-8"><div class="card bg-base-100 shadow-sm"><div class="card-body gap-4">
    <div><p class="text-sm uppercase tracking-wide text-primary font-semibold">Student client</p><h1 class="text-3xl font-semibold">Sign in to NET412</h1><p class="text-base-content/70 mt-2">Labs run in isolated Docker containers on this computer. The instructor server stores tasks, progress and grades.</p></div>
    <form id="login-form" class="space-y-4"><label class="block"><span class="label">Email address</span><input name="username" inputmode="email" class="input input-bordered w-full" autocomplete="username" required></label><label class="block"><span class="label">Password</span><input type="password" name="password" class="input input-bordered w-full" autocomplete="current-password" required></label><button class="btn btn-primary w-full">Sign in</button></form>
    <details class="border-t border-base-300 pt-4"><summary class="cursor-pointer font-medium">Instructor server settings</summary><form id="config-form" class="mt-4 flex gap-2"><input name="serverUrl" aria-label="Instructor server URL" class="input input-bordered flex-1" value="${escapeHtml(config.serverUrl)}" required><button class="btn btn-outline">Save</button></form><p class="text-sm text-base-content/70 mt-2">Use HTTPS for a remote server. Local testing can use http://127.0.0.1:8000.</p></details>
  </div></div></div>`);
}
function renderPasswordChange() {
  layout(`<div class="max-w-xl mx-auto mt-8"><section class="card bg-base-100 shadow-sm"><div class="card-body gap-4"><p class="record-kicker">Account setup</p><h1 class="text-3xl font-semibold">Choose your new password</h1><p>Before opening activities, replace your registration-number password with a password of your own. After an instructor reset, your current password is your registration number again.</p><form id="password-form" class="space-y-4"><label class="block"><span class="label">Current password</span><input name="current_password" type="password" autocomplete="current-password" class="input input-bordered w-full" required></label><label class="block"><span class="label">New password</span><input name="new_password" type="password" autocomplete="new-password" minlength="8" class="input input-bordered w-full" required></label><label class="block"><span class="label">Confirm new password</span><input name="confirm_password" type="password" autocomplete="new-password" minlength="8" class="input input-bordered w-full" required></label><p class="text-sm">Use at least 8 characters. Avoid common or entirely numeric passwords, personal details, and your registration number.</p><button class="btn btn-primary w-full">Save password and continue</button></form></div></section></div>`);
}
function renderDashboard() {
  const cards = state.activities.map(item => {
    const cached = activityCache.get(item.id);
    const label = state.opening === item.id ? 'Opening activity…' : cached?.spec ? 'Open activity →' : cached?.promise ? 'Preparing download… · Open activity →' : 'Download and open activity →';
    return `<button class="card activity-card bg-base-100 shadow-sm text-left border border-base-300" data-open="${escapeHtml(item.id)}" ${state.opening ? 'disabled' : ''} aria-busy="${state.opening === item.id}"><span class="card-body"><span class="card-title">${escapeHtml(item.title)}</span><span class="text-base-content/70">${escapeHtml(item.summary)}</span><span class="text-sm">${item.due_at ? `Due ${escapeHtml(new Date(item.due_at).toLocaleString())}` : 'No deadline'}${item.submissions_open === false ? ' · Submissions closed' : ''}</span><span class="badge badge-primary badge-outline mt-2">Version ${item.version}</span><strong class="activity-open">${label}</strong>${cached?.error ? '<span>Download interrupted. Select to retry.</span>' : ''}</span></button>`;
  }).join('');
  const rows = state.summary.tasks.map(item => `<tr><td>${escapeHtml(item.task_id)}</td><td>${item.completed}/${item.questions}</td><td>${item.score}/${item.possible}</td></tr>`).join('');
  layout(`<div class="flex flex-wrap justify-between gap-3 items-center"><div><h1 class="text-3xl font-semibold">Your activities</h1><p class="text-base-content/70">Select anywhere on an activity card to open it. Lab definitions download in the background and are cached for faster opening.</p></div>${button(`Sync pending (${state.pending})`, 'sync', 'btn-outline')}</div>
    ${state.pendingErrors.length ? `<div class="alert alert-warning mt-4">${state.pendingErrors.map(escapeHtml).join('; ')}</div>` : ''}
    <div class="grid md:grid-cols-2 gap-4 mt-6">${cards || '<div class="alert">No activities are published yet. Ask your instructor when the lab opens.</div>'}</div>
    <section class="card bg-base-100 shadow-sm mt-8"><div class="card-body"><h2 class="card-title">Recent progress</h2><div class="overflow-x-auto"><table class="table"><thead><tr><th>Task</th><th>Completed questions</th><th>Marks gained</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No submissions yet.</td></tr>'}</tbody></table></div></div></section>`);
}
function renderTask() {
  const spec = state.spec;
  const task = spec.tasks.find(item => item.id === state.task) || spec.tasks[0];
  const evidence = state.evidence;
  const pack = spec.environment.client_pack;
  const actions = spec.environment.actions || [];
  const targets = spec.environment.terminal_targets || [];
  const captureReady = state.running;
  const bundleStatus = spec.local_bundle ? `${spec.local_bundle.cached ? 'Verified cached' : 'Downloaded and verified'} lab definition v${spec.version} · ${spec.local_bundle.digest.slice(0, 12)}` : 'Lab definition unavailable';
  const taskTabs = spec.tasks.map(item => `<button class="tab ${item.id === task.id ? 'tab-active' : ''}" role="tab" aria-selected="${item.id === task.id}" data-task="${escapeHtml(item.id)}">${escapeHtml(item.id.toUpperCase())}</button>`).join('');
  const closed = submissionsClosed(spec);
  const fields = task.answers.map((item, index) => `<label class="block mt-4"><span class="label font-medium">${escapeHtml(item.label)}${item.type === 'flag' ? '' : ' (1 mark)'}</span>${item.type === 'paragraph' ? `<textarea name="${escapeHtml(item.key)}" aria-describedby="answer-feedback-${index}" class="textarea textarea-bordered w-full min-h-28"></textarea>` : `<input name="${escapeHtml(item.key)}" aria-describedby="answer-feedback-${index}" class="input input-bordered w-full">`}<span id="answer-feedback-${index}" class="answer-feedback" aria-live="polite"></span></label>`).join('');
  const progress = state.summary.tasks.find(row => row.activity_id === spec.id && row.task_id === task.id);
  const completed = progress?.completed || 0;
  const questions = progress?.questions || task.answers.length;
  const score = progress?.score || 0;
  const possible = progress?.possible || task.answers.reduce((n, q) => n + (q.type === 'flag' ? 5 : 1), 0);
  const complete = questions > 0 && completed === questions;
  const checks = progress?.checks || task.answers.map(q => ({ field: q.key, label: q.label, points: q.type === 'flag' ? 5 : 1, passed: false, attempted: false }));
  const observationSection = `<section class="card bg-base-100 shadow-sm automation-card" aria-labelledby="automation-title"><div class="card-body">
    <div class="record-heading"><div><p class="record-kicker">Your progress · ${escapeHtml(task.id.toUpperCase())}</p><h2 id="automation-title" class="card-title">Automation record</h2></div><span class="record-status ${complete ? 'is-complete' : ''}">${complete ? 'Complete' : progress?.attempts ? 'In progress' : 'Ready to begin'}</span></div>
    <div class="record-score"><strong>${score}<small> / ${possible}</small></strong><span>marks earned</span></div>
    <div class="record-meter"><div><label for="marks-progress">Marks gained</label><span>${Math.round(possible ? score / possible * 100 : 0)}%</span></div><progress id="marks-progress" max="${possible || 1}" value="${score}">${score}/${possible}</progress></div>
    <div class="record-meter"><div><label for="questions-progress">Completed questions</label><span>${completed} / ${questions}</span></div><progress id="questions-progress" max="${questions || 1}" value="${completed}">${completed}/${questions}</progress></div>
    <ul class="record-checks">${checks.map((q, index) => `<li class="${q.passed ? 'is-passed' : ''}"><span class="check-symbol" aria-hidden="true">${q.passed ? '✓' : q.attempted ? '↻' : index + 1}</span><div><span>${escapeHtml(q.label)}</span><small>${q.passed ? 'Accepted' : q.attempted ? 'Try again' : 'Not answered'}</small></div><span class="check-points">${q.passed ? q.points : 0}/${q.points}</span></li>`).join('')}</ul>
    <p class="record-footnote">${complete ? 'All marks earned. Download your work for Google Classroom before resetting.' : 'Accepted answers stay credited across attempts. Submit any remaining answers when you’re ready.'}</p>
    <div class="record-footer"><span>${progress?.attempts || 0} attempt${progress?.attempts === 1 ? '' : 's'}</span>${button('Refresh progress', 'refresh-progress', 'btn-ghost')}${state.pending ? `<span>${state.pending} pending sync</span>` : ''}</div>
  </div></section>`;
  layout(`<div class="breadcrumbs text-sm mb-4"><ul><li><button data-action="back">Activities</button></li><li>${escapeHtml(spec.id.toUpperCase())}</li></ul></div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.95fr)] gap-6"><div class="space-y-5">
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><p class="text-sm text-primary font-semibold">${escapeHtml(spec.window)}</p><h1 class="card-title text-2xl">${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.summary)}</p><p class="text-sm text-base-content/70">${escapeHtml(spec.safety)}</p>${renderTopology(spec.topology)}</div></section>
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="tabs tabs-border" role="tablist">${taskTabs}</div><h2 class="card-title mt-3">${escapeHtml(task.title)}</h2><p class="text-sm text-base-content/70">About ${task.time_minutes} minutes · ${escapeHtml(task.mode)}</p><ol class="list-decimal pl-6 space-y-2">${task.instructions.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>${renderCommands(task)}<div class="divider my-1"></div><p class="font-semibold">Evidence to keep</p><ul class="list-disc pl-6">${task.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="text-sm"><strong>Success:</strong> ${escapeHtml(task.success_criteria)}</p><p class="text-sm text-base-content/70 mt-2">${escapeHtml(task.reset)}</p></div></section>
      ${task.reference_evidence ? `<section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Supplied evidence</h2><p>${escapeHtml(task.reference_evidence)}</p></div></section>` : ''}
      ${task.solution ? `<section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Released walkthrough</h2><p>${escapeHtml(task.solution)}</p></div></section>` : ''}
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title">Submit answers and flag</h2><p class="text-sm text-base-content/70">Each question earns 1 mark and the flag earns 5 marks. You may submit partial answers and retry. Export your PCAP before resetting.</p><p id="deadline-status" role="status">${deadlineText(spec)}</p><form id="submit-form" data-activity="${escapeHtml(spec.id)}" data-task="${escapeHtml(task.id)}" aria-busy="${state.submitting}"><fieldset ${closed || state.submitting ? 'disabled' : ''}>${fields}<button class="btn btn-primary mt-5">${state.submitting ? 'Submitting…' : closed ? 'Submissions closed' : 'Submit task'}</button></fieldset></form></div></section>
    </div><div class="space-y-5">
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="flex justify-between items-center"><h2 class="card-title">Local lab</h2><span class="badge ${state.running ? 'badge-success' : 'badge-ghost'}">${state.running ? 'Running' : 'Stopped'}</span></div><p class="text-sm text-base-content/70">${escapeHtml(bundleStatus)}. The image builds on this computer when you start the lab.</p><p class="text-sm text-base-content/70">The containers share the isolated network shown in the topology. Start once; reset removes it.</p><div class="flex flex-wrap gap-2 mt-2">${actions.map(item => button(escapeHtml(item.label), escapeHtml(item.id), item.id === 'start' ? 'btn-primary' : item.id === 'reset' ? 'btn-error btn-outline' : 'btn-outline', item.id === 'start' ? state.running : !state.running)).join('')}</div>${(pack === 'l2-arp' || spec.environment.capture) ? captureReady ? `<a class="link link-primary text-sm mt-2" href="/api/lab/${escapeHtml(pack)}/pcap?activity=${encodeURIComponent(spec.id)}" download>Download ${escapeHtml(spec.environment.capture?.target || 'host_b')} PCAP for Wireshark</a><p class="text-sm">Stop tcpdump with Ctrl+C before downloading.</p>` : '<p class="text-sm text-base-content/70 mt-2">Start tcpdump yourself in a terminal. Stop it with Ctrl+C before downloading your capture.</p>' : ''}</div></section>
      <section class="card bg-base-100 shadow-sm"><div class="card-body"><div class="flex justify-between items-center"><h2 class="card-title">Container terminal</h2><select id="target" class="select select-bordered select-sm" aria-label="Terminal target">${targets.map(name => `<option value="${escapeHtml(name)}" ${state.target === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div><p class="text-sm text-base-content/70">Shell access is confined to the selected disposable container. Use Ctrl+C to stop a command.</p><button class="btn btn-outline btn-sm" data-action="new-terminal" ${!state.running ? 'disabled' : ''}>Open session</button><div id="terminal-tabs" class="tabs tabs-border" role="tablist" aria-label="Terminal sessions"></div><div id="terminal" aria-label="Container terminal"></div></div></section>
      ${observationSection}
      <section class="card bg-base-100 shadow-sm work-download"><div class="card-body"><p class="record-kicker">Google Classroom submission</p><h2 class="card-title">Download your work</h2><p class="text-sm">Save a ZIP of the work directories on all ${topologyModel(spec.topology).devices.length || targets.length} topology containers, grouped by container name. Submit it separately through Google Classroom.</p><p class="text-sm">Stop captures and save open files first. Downloads also work before starting or after stopping a lab; first-time preparation may take a few minutes. Download before resetting.</p>${button(state.downloading ? 'Preparing ZIP…' : 'Download work ZIP', 'download-work', 'btn-primary', state.downloading)}<code class="text-sm">${escapeHtml(zipName())}</code></div></section>
    </div></div>`);
  restoreAnswers();
  mountTerminals();
}
function submissionsClosed(spec) {
  return spec?.submissions_open === false || Boolean(spec?.due_at && Date.now() >= new Date(spec.due_at).getTime());
}
function deadlineText(spec) {
  return submissionsClosed(spec) ? 'The due date has passed. Submissions are closed; you can continue reading and practising.' : spec.due_at ? `Submit by ${escapeHtml(new Date(spec.due_at).toLocaleString())}.` : 'No submission deadline.';
}
function zipName() {
  const safe = value => String(value).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 100) || 'unknown';
  return `${safe(state.regNumber || state.user)}_${safe(state.spec.id)}.zip`;
}
function draftKey(form) { return `${form.dataset.activity}:${form.dataset.task}`; }
function rememberAnswers() {
  const form = document.querySelector('#submit-form');
  if (form) state.drafts[draftKey(form)] = Object.fromEntries([...form.querySelectorAll('input[name], textarea[name]')].map(field => [field.name, field.value]));
}
function restoreAnswers() {
  const form = document.querySelector('#submit-form');
  if (!form) return;
  const progress = state.summary.tasks.find(row => row.activity_id === form.dataset.activity && row.task_id === form.dataset.task);
  const draft = state.drafts[draftKey(form)] || {};
  for (const field of form.querySelectorAll('input[name], textarea[name]')) {
    const check = progress?.checks.find(check => check.field === field.name);
    field.value = draft[field.name] ?? check?.value ?? '';
    // Retain an accepted answer when a later partial submission leaves it blank.
    if (!field.value && check?.passed) field.value = check.value;
    paintAnswer(field, check);
  }
}
function paintAnswer(field, check) {
  const unchanged = check?.attempted && field.value === check.value;
  const valuePassed = check?.value_passed ?? check?.passed;
  field.classList.toggle('answer-correct', Boolean(unchanged && valuePassed));
  field.classList.toggle('answer-wrong', Boolean(unchanged && !valuePassed));
  field.setAttribute('aria-invalid', String(Boolean(unchanged && !valuePassed)));
  const feedback = document.getElementById(field.getAttribute('aria-describedby'));
  feedback.textContent = state.submitting ? 'Submitting…' : unchanged ? valuePassed ? '✓ Correct · saved' : 'Incorrect · saved; try again' : field.value ? 'Edited · not submitted' : 'Not submitted';
}
async function prepareActivity(item, force = false) {
  let entry = activityCache.get(item.id);
  if (entry && entry.digest === item.spec_digest && !force) {
    if (entry.spec) return entry.spec;
    if (entry.promise) return entry.promise;
  }
  entry = { digest: item.spec_digest };
  activityCache.set(item.id, entry);
  entry.promise = api(`activities/${encodeURIComponent(item.id)}`).then(spec => {
    entry.spec = spec; entry.error = null; return spec;
  }).catch(error => { entry.error = error.message; throw error; }).finally(() => {
    entry.promise = null;
    if (state.user && !state.spec && !state.opening) render();
  });
  return entry.promise;
}
async function prefetchActivities() {
  // One transfer at a time per student; clicks share the in-flight request.
  const user = state.user;
  for (const item of state.activities) {
    if (state.user !== user || state.passwordChangeRequired) break;
    try { await prepareActivity(item); } catch { /* The card offers retry. */ }
  }
}

function render() {
  if (!state.user) api('config').then(renderLogin).catch(error => layout(`<p class="alert alert-error">${escapeHtml(error.message)}</p>`));
  else if (state.passwordChangeRequired) renderPasswordChange(); else if (!state.spec) renderDashboard(); else renderTask();
}
function closeTerminals(pack) {
  for (const [id, session] of state.sessions) {
    if (pack && session.pack !== pack) continue;
    session.observer.disconnect(); session.socket.close(); session.terminal.dispose();
    state.sessions.delete(id);
  }
  if (!state.sessions.has(state.activeSession)) state.activeSession = null;
}
function mountTerminals() {
  const frame = document.querySelector('#terminal');
  if (!frame) return;
  if (!state.running) { frame.textContent = 'Start the lab to open a shell.'; return; }
  const pack = state.spec.environment.client_pack;
  const sessions = [...state.sessions.values()].filter(s => s.pack === pack && s.activity === state.spec.id);
  if (!sessions.length) { openTerminal(); return; }
  if (!sessions.some(s => s.id === state.activeSession)) state.activeSession = sessions[0].id;
  document.querySelector('#terminal-tabs').innerHTML = sessions.map(s => `<button role="tab" aria-selected="${s.id === state.activeSession}" class="tab ${s.id === state.activeSession ? 'tab-active' : ''}" data-session="${s.id}">${escapeHtml(s.label)}</button><button class="btn btn-ghost btn-xs" aria-label="Close ${escapeHtml(s.label)}" data-close-session="${s.id}">×</button>`).join('');
  for (const session of sessions) {
    session.element.hidden = session.id !== state.activeSession;
    frame.append(session.element);
    if (!session.element.hidden) requestAnimationFrame(() => { session.resize(); session.terminal.focus(); });
  }
}
function openTerminal() {
  if (!state.running) return;
  const pack = state.spec.environment.client_pack;
  const target = state.target;
  const countKey = `${pack}:${target}`;
  const number = state.sessionCounts[countKey] = (state.sessionCounts[countKey] || 0) + 1;
  const id = crypto.randomUUID();
  const element = document.createElement('div'); element.className = 'terminal-frame';
  document.querySelector('#terminal').append(element);
  const terminal = new Terminal({ cursorBlink: true, scrollback: 5000,
    fontFamily: '"Latin Modern Mono", ui-monospace, monospace', fontSize: 13,
    theme: { background: '#111412', foreground: '#f2eee9' } });
  const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element); fit.fit();
  const url = new URL('/terminal', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [key, value] of Object.entries({ pack, target, activity: state.spec.id, rows: terminal.rows, cols: terminal.cols })) url.searchParams.set(key, value);
  const socket = new WebSocket(url); socket.binaryType = 'arraybuffer';
  const resize = () => {
    if (!element.isConnected || element.hidden) return;
    fit.fit();
    if (socket.readyState === WebSocket.OPEN) socket.send(`\0${JSON.stringify({ type: 'resize', rows: terminal.rows, cols: terminal.cols })}`);
  };
  const observer = new ResizeObserver(resize); observer.observe(element);
  state.sessions.set(id, { id, pack, activity: state.spec.id, target, label: `${target} S${number}`, terminal, socket, observer, element, resize });
  state.activeSession = id;
  socket.onopen = () => { resize(); terminal.focus(); };
  socket.onmessage = event => terminal.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data);
  socket.onclose = () => terminal.write('\r\n[Terminal disconnected]\r\n');
  const encoder = new TextEncoder();
  terminal.onData(data => { if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data)); });
  terminal.onBinary(data => { if (socket.readyState === WebSocket.OPEN) socket.send(Uint8Array.from(data, c => c.charCodeAt(0))); });
  document.fonts.ready.then(resize);
  mountTerminals();
}
async function refresh() {
  const me = await api('me'); state.user = me.username; state.regNumber = me.reg_number || me.username; state.passwordChangeRequired = Boolean(me.password_change_required); state.evidence = me.evidence; state.pending = me.pending; state.pendingErrors = me.pendingErrors || [];
  if (state.passwordChangeRequired) { closeTerminals(); state.spec = null; render(); return; }
  [state.activities, state.progress] = await Promise.all([
    api('activities').then(data => data.activities), api('progress').then(data => { state.summary = data.summary; return data.submissions; })]);
  if (state.spec) { const item = state.activities.find(a => a.id === state.spec.id); if (item) Object.assign(state.spec, { due_at: item.due_at, submissions_open: item.submissions_open }); }
  render();
  void prefetchActivities();
}
app.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'config-form') { activityCache.clear(); await api('config', 'POST', data); notify('Instructor server URL saved.'); }
    if (form.id === 'login-form') { await api('login', 'POST', data); state.drafts = {}; activityCache.clear(); await refresh(); }
    if (form.id === 'password-form') {
      form.querySelector('button').disabled = true;
      await api('password/change', 'POST', data);
      state.passwordChangeRequired = false;
      await refresh(); notify('Password changed. You can now open your activities.');
    }
    if (form.id === 'submit-form') {
      if (state.submitting || submissionsClosed(state.spec)) return;
      rememberAnswers(); state.submitting = true; render();
      const result = await api('submit', 'POST', { activity_id: state.spec.id, task_id: form.dataset.task, spec_version: state.spec.version, answers: data });
      state.submitting = false;
      await refresh();
      notify(result.queued ? 'Submission saved locally and queued for sync.' : `Submitted: ${result.grading.score}/${result.grading.possible} marks this attempt.`);
    }
  } catch (error) { state.submitting = false; notify(error.message); }
});
app.addEventListener('click', async event => {
  const opened = event.target.closest('[data-open]');
  const task = event.target.closest('[role=tab][data-task]');
  const action = event.target.closest('[data-action]')?.dataset.action;
  const selectedSession = event.target.closest('[data-session]')?.dataset.session;
  const closedSession = event.target.closest('[data-close-session]')?.dataset.closeSession;
  try {
    if (selectedSession) { state.activeSession = selectedSession; mountTerminals(); }
    else if (closedSession) {
      const session = state.sessions.get(closedSession);
      session.observer.disconnect(); session.socket.close(); session.terminal.dispose(); session.element.remove();
      state.sessions.delete(closedSession); mountTerminals();
    }
    else if (action === 'refresh-progress') { await refresh(); }
    else if (action === 'download-work') {
      state.downloading = true; render();
      try {
        const response = await fetch(`/api/activities/${encodeURIComponent(state.spec.id)}/work.zip?task=${encodeURIComponent(state.task)}`);
        if (!response.ok) throw new Error((await response.json()).error || 'Download failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || zipName();
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        state.message = 'Work ZIP downloaded. Submit it separately through Google Classroom.';
      } finally { state.downloading = false; render(); }
    }
    else if (action === 'new-terminal') openTerminal();
    else if (opened) {
      if (state.opening) return;
      const id = opened.dataset.open;
      const item = state.activities.find(item => item.id === id);
      state.opening = id; state.message = 'Opening activity… Preparing its cached lab definition.'; render();
      try {
        const spec = await prepareActivity(item);
        state.spec = spec; state.task = spec.tasks[0].id;
        state.target = spec.environment.terminal_targets?.[0] || null;
        state.running = false; state.message = 'Workbook ready. Checking local containers…'; render();
        // Activate the selected pack, then check Docker without delaying the workbook.
        api(`activities/${encodeURIComponent(id)}`).then(async fresh => {
          if (state.spec?.id !== id) return;
          state.spec = fresh;
          const status = await api(`lab/${fresh.environment.client_pack}/status?activity=${encodeURIComponent(fresh.id)}`);
          if (state.spec?.id === id) { state.running = status.running; state.message = ''; render(); }
        }).catch(error => { if (state.spec?.id === id) notify(`Workbook ready. Local lab status: ${error.message}`); });
      } finally { state.opening = null; }
    }
    else if (task) { state.task = task.dataset.task; render(); }
    else if (action === 'theme') { const next = document.documentElement.dataset.theme === 'dark' ? 'corporate' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('net412-theme', next); } catch { /* keep the selection for this visit */ } }
    else if (action === 'back') { rememberAnswers(); state.spec = null; state.message = ''; render(); refresh().catch(error => notify(error.message)); }
    else if (action === 'reset-password') {
      state.message = 'Resetting password…'; render();
      const result = await api('password/reset', 'POST', {});
      closeTerminals(); state.drafts = {}; activityCache.clear(); state.user = null; state.spec = null; notify(result.message);
    }
    else if (action === 'logout') { closeTerminals(); state.drafts = {}; activityCache.clear(); await api('logout', 'POST', {}); state.user = null; state.spec = null; render(); }
    else if (action === 'sync') { const result = await api('sync', 'POST', {}); await refresh(); state.pending = result.pending; state.pendingErrors = result.errors || []; notify(`${result.pending} item(s) still pending.${state.pendingErrors.length ? ' Check the sync errors below.' : ''}`); }
    else if (action && state.spec?.environment.actions.some(item => item.id === action)) {
      state.message = `${action[0].toUpperCase()}${action.slice(1)} in progress…`; render();
      const result = await api(`lab/${state.spec.environment.client_pack}/${action}?activity=${encodeURIComponent(state.spec.id)}`, 'POST', { task_id: state.task });
      if (action === 'start') state.running = true;
      if (action === 'reset') { state.running = false; closeTerminals(state.spec.environment.client_pack); }
      state.evidence = result.evidence;
      notify(result.message || `${action} completed.`);
    }
  } catch (error) { notify(error.message); }
});
app.addEventListener('change', event => { if (event.target.id === 'target') { state.target = event.target.value; } });
refresh().catch(() => render());

app.addEventListener('keydown', event => {
  const tab = event.target.closest('[data-session]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll('[data-session]')];
  const index = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  state.activeSession = tabs[next].dataset.session; mountTerminals();
  document.querySelector(`[data-session="${state.activeSession}"]`).focus();
});

app.addEventListener('input', event => {
  if (!event.target.closest('#submit-form')) return;
  const form = event.target.form;
  const progress = state.summary.tasks.find(row => row.activity_id === form.dataset.activity && row.task_id === form.dataset.task);
  paintAnswer(event.target, progress?.checks.find(c => c.field === event.target.name));
});
setInterval(() => {
  const form = document.querySelector('#submit-form');
  if (!form || !state.spec) return;
  const closed = submissionsClosed(state.spec);
  form.querySelector('fieldset').disabled = closed || state.submitting;
  form.querySelector('button').textContent = state.submitting ? 'Submitting…' : closed ? 'Submissions closed' : 'Submit task';
  document.querySelector('#deadline-status').textContent = closed ? 'The due date has passed. Submissions are closed; you can continue reading and practising.' : state.spec.due_at ? `Submit by ${new Date(state.spec.due_at).toLocaleString()}.` : 'No submission deadline.';
}, 1000);
setInterval(async () => {
  if (!state.user || state.passwordChangeRequired || document.hidden) return;
  try {
    const data = await api('activities'); state.activities = data.activities;
    if (state.spec) {
      const item = data.activities.find(a => a.id === state.spec.id);
      if (item) Object.assign(state.spec, { due_at: item.due_at, submissions_open: item.submissions_open });
    }
  } catch { /* Keep the workbook usable; submissions remain server-validated. */ }
}, 30000);
