import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const username = process.env.NET412_BROWSER_USER;
const password = process.env.NET412_BROWSER_PASSWORD;
if (!username || !password) throw new Error('Set NET412_BROWSER_USER and NET412_BROWSER_PASSWORD for a test account');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-chrome-'));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=9223', `--user-data-dir=${profile}`, 'http://127.0.0.1:4174'
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 30; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9223/json')).json()).find(item => item.type === 'page' && item.url.includes('4174')); }
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await sleep(500);
  assert.ok((await evaluate('document.body.innerText')).includes('Sign in to NET412'));
  await evaluate(`document.querySelector('input[name=username]').value=${JSON.stringify(username)}; document.querySelector('input[name=password]').value=${JSON.stringify(password)}; document.querySelector('#login-form').requestSubmit()`);
  await sleep(1000);
  assert.ok((await evaluate('document.body.innerText')).includes('Your activities'), 'Login did not open the dashboard');
  await evaluate("document.querySelector('[data-open=l2-arp]').click()");
  await sleep(1000);
  const page = await evaluate('document.body.innerText');
  assert.ok(page.includes('ARP poisoning, path changes and hardening'));
  assert.ok(page.includes('/work/poison_student.py'));
  assert.ok(page.includes('Start lab'));
  await evaluate("document.querySelector('[data-task=\"l2.b\"]').click()");
  await sleep(300);
  assert.ok((await evaluate('document.body.innerText')).includes('Supplied ICMP comparison'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('/tmp/net412-workbook.png', Buffer.from(screenshot.data, 'base64'));
  console.log('Browser login, activity navigation, and workbook rendering passed');
} finally {
  ws?.close();
  chrome.kill();
  await sleep(250);
  await fs.rm(profile, { recursive: true, force: true });
}
