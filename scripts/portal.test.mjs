import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tar from 'tar-stream';
import { unzipSync, strFromU8 } from 'fflate';
import { startServer } from '../src/server.js';
import { computeBundleDigest } from '../src/bundles.js';

async function fixture(t, count = 5, personalized = false, hiddenDataDir = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'net412-portal-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = hiddenDataDir ? path.join(root, '.net412-lab') : root;
  await fs.mkdir(dataDir, { recursive: true });
  const targets = Array.from({length:count}, (_, i) => `host_${i}`);
  const bundle = { activity_id:'lab2', version:1, files:{'Dockerfile':'FROM scratch\n','compose.yaml':'services: {}\n'} };
  bundle.digest = computeBundleDigest(bundle);
  const spec = { id:'lab2', version:1, title:'Test', tasks:[{id:'task.a'}], topology:{devices:targets.map(name => ({name}))}, environment:{client_pack:'compose',terminal_targets:targets,bundle:{digest:bundle.digest}} };
  if (personalized) spec.environment.personalization = {task_id:'task.a'};
  const personalBundle = {...bundle, files:{...bundle.files, 'fragment.txt':'synthetic personalized content'}};
  personalBundle.digest = computeBundleDigest(personalBundle);
  const calls = {};
  let released = true, revision = 'v1', revoked = false, available = false, prepared = 0, failBundle = false;
  const remote = createServer(async (req, res) => {
    calls[req.url] = (calls[req.url] || 0) + 1;
    let payload = ''; for await (const chunk of req) payload += chunk;
    let result = {};
    if (req.url.endsWith('/login/')) { revoked = false; result = {token:'token', username:'student@example.edu', reg_number:'bsc-10-10'}; }
    else if (revoked) { res.statusCode = 401; result = {error:'Authentication required'}; }
    else if (req.url.endsWith('/me/')) result = {username:'student@example.edu'};
    else if (req.url.endsWith('/password/reset/')) { revoked = true; result = {ok:true,message:'Password reset'}; }
    else if (req.url.endsWith('/activities/')) result = {activities:released ? [{id:'lab2', spec_digest:revision, bundle_digest:bundle.digest}] : []};
    else if (req.url.endsWith('/lab2/')) result = {...spec, title:revision};
    else if (req.url.endsWith('/initialize/')) result = personalBundle;
    else if (req.url.endsWith('/bundle/')) { if (failBundle) { res.statusCode = 503; result = {error:'Try again'}; } else result = bundle; }
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => remote.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => remote.close(resolve)));
  await fs.writeFile(path.join(dataDir,'config.json'), JSON.stringify({serverUrl:`http://127.0.0.1:${remote.address().port}`}));
  const docker = {getContainer: name => ({
    inspect:async () => { if (!available) throw Object.assign(new Error('Missing'), {statusCode:404}); return {Config:{WorkingDir:'/work'}}; },
    getArchive:async () => { const p = tar.pack(); p.entry({name:'.',type:'directory'}); p.entry({name:'.hidden'}, 'saved'); p.entry({name:'nested',type:'directory'}); p.entry({name:'nested/result.bin'}, Buffer.from([0,255,1])); p.entry({name:'empty',type:'directory'}); p.finalize(); return p; }
  })};
  const factory = () => ({id:'compose',taskIds:new Set(['task.a']),terminalTargets:new Set(targets),containerName:n=>n,exportTargets:async()=>targets,prepareExport:async()=>{prepared++;available=true;},status:async()=>({running:false})});
  const server = await startServer({dataDir, docker, factories:new Map([['compose',factory]])});
  t.after(() => new Promise(resolve => server.close(resolve)));
  let cookie='';
  async function request(url, payload) {
    return fetch(`http://127.0.0.1:${server.address().port}/api/${url}`, {method:payload?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
  }
  const login = await request('login',{username:'student@example.edu',password:'test'});
  cookie = login.headers.get('set-cookie').split(';')[0];
  return {request,calls,dataDir,get prepared(){return prepared;},change:()=>{revision='v2';},unassign:()=>{released=false;},fail:()=>{failBundle=true;},recover:()=>{failBundle=false;}};
}

test('ZIP endpoint works before start and for stopped labs with arbitrary container counts', async t => {
  for (const count of [1, 5]) await t.test(`${count} containers`, async t => {
    const f = await fixture(t,count);
    assert.equal((await f.request('activities/lab2')).status,200);
    for (let attempt=0; attempt<2; attempt++) {
      const response = await f.request('activities/lab2/work.zip');
      assert.equal(response.status,200, response.ok ? undefined : await response.text());
      assert.match(response.headers.get('content-disposition'), /bsc-10-10_lab2.zip/);
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      for (let i=0;i<count;i++) {
        assert.equal(strFromU8(files[`host_${i}/.hidden`]),'saved');
        assert.deepEqual([...files[`host_${i}/nested/result.bin`]],[0,255,1]);
        assert.ok(files[`host_${i}/empty/`]);
      }
    }
    assert.equal(f.prepared,1);
    for (let i=0;i<50 && (await fs.readdir(f.dataDir)).some(n=>n.startsWith('work-export-'));i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await fs.readdir(f.dataDir)).filter(n=>n.startsWith('work-export-')).length,0);
  });
});

test('ZIP download serves the archive from the hidden default client data directory', async t => {
  const f = await fixture(t, 4, true, true);
  assert.equal((await f.request('activities/lab2')).status, 200);
  const response = await f.request('activities/lab2/work.zip?task=task.a');
  assert.equal(response.status, 200, response.ok ? undefined : await response.text());
  assert.match(response.headers.get('content-type'), /application\/zip/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  for (let i = 0; i < 4; i++) assert.equal(strFromU8(files[`host_${i}/.hidden`]), 'saved');
});

test('ZIP download loads a personalized activity in a fresh session without opening it first', async t => {
  const f = await fixture(t, 4, true);
  const response = await f.request('activities/lab2/work.zip?task=task.a');
  assert.equal(response.status, 200, response.ok ? undefined : await response.text());
  assert.match(response.headers.get('content-disposition'), /bsc-10-10_lab2.zip/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  for (let i = 0; i < 4; i++) assert.equal(strFromU8(files[`host_${i}/.hidden`]), 'saved');
  assert.equal(f.calls['/api/v1/activities/lab2/initialize/'], 1);
  assert.equal(f.prepared, 1);

  f.unassign();
  await f.request('activities');
  assert.equal((await f.request('activities/lab2/work.zip?task=task.a')).status, 404);
  assert.equal(f.prepared, 1);
});

test('concurrent opens coalesce downloads, cached reopen avoids transfers, revision refreshes spec', async t => {
  const f=await fixture(t);
  const results=await Promise.all(Array.from({length:5},()=>f.request('activities/lab2')));
  assert.ok(results.every(r=>r.status===200));
  assert.equal(f.calls['/api/v1/activities/lab2/bundle/'],1);
  assert.equal(f.calls['/api/v1/activities/lab2/'],1);
  await f.request('activities/lab2');
  assert.equal(f.calls['/api/v1/activities/lab2/'],1);
  f.change(); await f.request('activities');
  assert.equal((await (await f.request('activities/lab2')).json()).title,'v2');
  assert.equal(f.calls['/api/v1/activities/lab2/bundle/'],1);
  f.unassign(); await f.request('activities');
  assert.equal((await f.request('activities/lab2')).status,404);
});

test('failed downloads can be retried and are not cached as successful', async t => {
  const f=await fixture(t); f.fail();
  assert.equal((await f.request('activities/lab2')).status,503);
  f.recover(); assert.equal((await f.request('activities/lab2')).status,200);
});

test('personalized Compose uses initialization and verifies its distinct bundle digest', async t => {
  const f = await fixture(t, 4, true);
  assert.equal((await f.request('activities/lab2')).status, 200);
  assert.equal(f.calls['/api/v1/activities/lab2/initialize/'], 1);
  assert.equal(f.calls['/api/v1/activities/lab2/bundle/'], undefined);
  assert.equal((await f.request('activities/lab2')).status, 200);
  assert.equal(f.calls['/api/v1/activities/lab2/initialize/'], 1);
});

test('password reset signs out local session; email recovery is unavailable', async t => {
  const f=await fixture(t);
  assert.equal((await f.request('password/reset',{})).status,200);
  assert.equal((await f.request('me')).status,401);
  assert.equal((await f.request('password/recover',{email:'student@example.edu'})).status,404);
});
