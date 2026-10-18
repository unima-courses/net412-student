import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { unzipSync, strFromU8 } from 'fflate';
import { promisify } from 'node:util';

const username = process.env.NET412_BROWSER_USER;
const password = process.env.NET412_BROWSER_PASSWORD;
const clientUrl = process.env.NET412_BROWSER_URL || 'http://127.0.0.1:4174';
const run = promisify(execFile);
if (!username || !password) throw new Error('Set NET412_BROWSER_USER and NET412_BROWSER_PASSWORD for a test account');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-chrome-'));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9223', `--user-data-dir=${profile}`, clientUrl
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
let started = false;
let initiallyRunning = false;
try {
  let target;
  for (let i = 0; i < 30; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9223/json')).json()).find(item => item.type === 'page' && item.url.startsWith(clientUrl)); }
    catch { /* browser starting */ }
    if (target) break;
    await sleep(200);
  }
  assert.ok(target, 'Chrome did not expose the client page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.once('open', resolve));
  let id = 0;
  async function command(method, params = {}) {
    const next = ++id;
    return new Promise((resolve, reject) => {
      const onMessage = raw => {
        const message = JSON.parse(raw.toString());
        if (message.id !== next) return;
        ws.off('message', onMessage);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  await sleep(500);
  assert.ok((await evaluate('document.body.innerText')).includes('Sign in to NET412'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1507, height: 1045, deviceScaleFactor: 1, mobile: false });
  const loginScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/tmp/net412-login.png', Buffer.from(loginScreenshot.data, 'base64'));
  await evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)}; document.querySelector('input[name=password]').value=${JSON.stringify(password)}; document.querySelector('#login-form').requestSubmit()`);
  await sleep(1000);
  assert.ok((await evaluate('document.body.innerText')).includes('Your activities'), 'Login did not open the dashboard');
  const dashboardScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/tmp/net412-dashboard.png', Buffer.from(dashboardScreenshot.data, 'base64'));
  await evaluate(`window.labSockets = []; const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); this.output = ''; window.labSockets.push(this);
        this.addEventListener('message', event => { this.output += typeof event.data === 'string' ? event.data : new TextDecoder().decode(new Uint8Array(event.data)); });
      }
    };`);
  await evaluate("document.querySelector('[data-open=l2-arp]').click()");
  await sleep(1000);
  const page = await evaluate('document.body.innerText');
  assert.ok(page.includes('Bidirectional ARP poisoning'));
  assert.ok(page.includes('/work/poison_student.py'));
  assert.ok(page.includes('Lab topology'));
  assert.ok(page.includes('host_a') && page.includes('host_b') && page.includes('server_1'));
  assert.ok(page.includes("ip neigh show 10.77.12.20"), 'Terminal verification commands are missing');
  assert.ok(page.includes('lab definition v1'), 'Assigned lab bundle was not downloaded and verified');
  assert.ok(page.includes('Start lab'));
  initiallyRunning = await evaluate("document.querySelector('[data-action=start]').disabled");
  if (initiallyRunning) assert.equal(process.env.NET412_REUSE_RUNNING, '1', 'Use a disposable test account or explicitly allow reusing this running lab');
  if (!initiallyRunning) {
    await evaluate("document.querySelector('[data-action=start]').click()");
    started = true;
    for (let i = 0; i < 240; i++) {
      if ((await evaluate('document.body.innerText')).includes('Running')) break;
      await sleep(500);
    }
  }
  assert.ok((await evaluate('document.body.innerText')).includes('Running'), 'Lab did not start');
  const terminalResult = await evaluate(`new Promise((resolve, reject) => {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(scheme + '//' + location.host + '/terminal?pack=l2-arp&target=host_a&rows=28&cols=96');
    socket.binaryType = 'arraybuffer';
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let output = '';
    const send = value => socket.send(encoder.encode(value));
    const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
    const waitFor = async (text, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (!output.includes(text) && Date.now() < deadline) await delay(50);
      if (!output.includes(text)) throw new Error('Timed out waiting for ' + text + ': ' + output.slice(-1200));
    };
    socket.onmessage = event => { output += decoder.decode(new Uint8Array(event.data), { stream: true }); };
    socket.onerror = () => reject(new Error('Terminal WebSocket failed'));
    socket.onopen = async () => {
      try {
        send("printf 'alpha\\nbeta\\n' > /work/editor-test.txt\\r");
        await delay(150);
        send("printf '__TERM__%s__SIZE__%s__\\n' \\\"$TERM\\\" \\\"$(stty size)\\\"\\r");
        await waitFor('__TERM__xterm-256color__SIZE__28 96__');
        send('nano /work/editor-test.txt\\r');
        await waitFor('GNU nano');
        send('\\u001b[C');
        await delay(80);
        send('Z');
        send('\\u000f');
        await waitFor('Write to File:');
        send('\\r');
        await waitFor('Wrote');
        send('\\u0018');
        await delay(150);
        send("grep -qx 'aZlpha' /work/editor-test.txt && echo __EDITOR_OK__\\r");
        await waitFor('__EDITOR_OK__');
        send("printf 'one\\n' > /work/vi-test.txt && vi /work/vi-test.txt\\r");
        await delay(300);
        send('A-two\\u001b:wq\\r');
        await delay(250);
        send("grep -qx 'one-two' /work/vi-test.txt && echo __VI_OK__\\r");
        await waitFor('__VI_OK__');
        send("curl -s http://10.77.12.20:8080/ >/dev/null && echo __BASELINE_OK__\\r");
        await waitFor('__BASELINE_OK__');
        socket.close();
        resolve({ term: true, nano: true, vi: true });
      } catch (error) {
        socket.close();
        reject(error);
      }
    };
  })`.replaceAll('10.77.12', process.env.NET412_BROWSER_SUBNET || '10.77.12'));
  assert.deepEqual(terminalResult, { term: true, nano: true, vi: true }, 'Terminal PTY editor test failed');
  // Verify separate shells retain state and sockets across terminal and activity navigation.
  const initialSockets = await evaluate('labSockets.length');
  const sendToShell = (index, text) => evaluate(`labSockets[${index}].send(new TextEncoder().encode(${JSON.stringify(text + '\r')}))`);
  await sendToShell(0, 'export SESSION_VALUE=first');
  await sleep(150);
  await evaluate("document.querySelector('[data-action=new-terminal]').click()");
  await sleep(250);
  assert.equal(await evaluate('labSockets.length'), initialSockets + 1);
  const secondSocket = initialSockets;
  await sendToShell(secondSocket, 'export SESSION_VALUE=second');
  await sleep(150);
  assert.ok((await evaluate('document.body.innerText')).includes('host_a S2'));
  await evaluate("document.querySelectorAll('[data-session]')[0].click(); document.querySelector('[name=sender_ip]').value='10.77.12.20'");
  await evaluate("document.querySelector('[data-action=back]').click()");
  await sleep(300);
  await evaluate("document.querySelector('[data-open=l2-arp]').click()");
  await sleep(500);
  assert.equal(await evaluate('labSockets.length'), initialSockets + 1, 'Navigation recreated terminal sockets');
  assert.equal(await evaluate("document.querySelector('[name=sender_ip]').value"), '10.77.12.20');
  await sendToShell(0, 'printf "__ONE_%s__\\n" "$SESSION_VALUE"');
  await sendToShell(secondSocket, 'printf "__TWO_%s__\\n" "$SESSION_VALUE"');
  await sleep(250);
  assert.ok((await evaluate('labSockets[0].output')).includes('__ONE_first__'), 'First session lost its shell state');
  assert.ok((await evaluate(`labSockets[${secondSocket}].output`)).includes('__TWO_second__'), 'Second session lost its independent shell state');
  assert.ok((await evaluate('document.body.innerText')).includes('Download work ZIP'));
  const workZip = await evaluate(`fetch('/api/activities/l2-arp/work.zip?task=l2.a').then(async response => ({
    status: response.status, disposition: response.headers.get('content-disposition'),
    data: btoa(Array.from(new Uint8Array(await response.arrayBuffer()), b => String.fromCharCode(b)).join(''))
  }))`);
  assert.equal(workZip.status, 200);
  assert.ok(workZip.disposition.includes(`${username}-l2.a.zip`));
  const workFiles = unzipSync(Buffer.from(workZip.data, 'base64'));
  assert.ok(workFiles['host_a/'] && workFiles['host_b/'] && workFiles['server_1/']);
  assert.equal(strFromU8(workFiles['host_a/editor-test.txt']), 'aZlpha\nbeta\n');
  assert.equal(await evaluate("fetch('/api/activities/l2-arp/work.zip?task=invalid').then(r => r.status)"), 404);
  await evaluate("document.querySelector('#submit-form').requestSubmit()");
  for (let i=0; i<50; i++) {
    if (await evaluate("document.querySelector('#marks-progress')?.value === 1")) break;
    await sleep(100);
  }
  assert.equal(await evaluate("document.querySelector('#marks-progress').value"), 1);
  assert.equal(await evaluate("document.querySelector('#questions-progress').value"), 1);
  assert.ok((await evaluate("document.querySelector('.record-checks .is-passed').innerText")).includes('Accepted'));
  assert.equal(await evaluate('labSockets.length'), initialSockets + 1, 'Submission progress refresh recreated terminals');
  assert.ok(!(await evaluate('document.body.innerText')).includes('L2.B'));
  assert.ok(!(await evaluate('document.body.innerText')).includes('Run ARP script'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1507, height: 1045, deviceScaleFactor: 1, mobile: false });
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/tmp/net412-workbook.png', Buffer.from(screenshot.data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  const mobileViewport = await evaluate(`({
    width: innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerWidth: document.querySelector('.navbar').getBoundingClientRect().width,
    overflowing: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => ({ tag: element.tagName, classes: element.className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
  })`);
  assert.ok(mobileViewport.scrollWidth <= mobileViewport.clientWidth, `Mobile layout overflows: ${mobileViewport.scrollWidth}px content in ${mobileViewport.clientWidth}px viewport; ${JSON.stringify(mobileViewport.overflowing)}`);
  assert.ok(mobileViewport.headerWidth >= mobileViewport.clientWidth - 1, `Mobile header is only ${mobileViewport.headerWidth}px in a ${mobileViewport.clientWidth}px viewport`);
  const mobileScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/tmp/net412-workbook-mobile.png', Buffer.from(mobileScreenshot.data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1507, height: 1045, deviceScaleFactor: 1, mobile: false });
  if (started) {
    await evaluate("document.querySelector('[data-action=reset]').click()");
    for (let i = 0; i < 40; i++) {
      if ((await evaluate('document.body.innerText')).includes('Stopped')) break;
      await sleep(500);
    }
    assert.ok((await evaluate('document.body.innerText')).includes('Stopped'), 'Lab did not reset');
    started = false;
  }
  console.log('Browser login, activity navigation, PTY editing, lab controls, and workbook rendering passed');
} finally {
  if (started && ws?.readyState === WebSocket.OPEN) {
    const id = 999999;
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: "fetch('/api/lab/l2-arp/reset', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})", awaitPromise: true } }));
    await sleep(1000);
  }
  ws?.close();
  chrome.kill();
  await sleep(250);
  await fs.rm(profile, { recursive: true, force: true });
}
