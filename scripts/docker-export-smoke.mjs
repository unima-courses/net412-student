/** Isolated real-Docker export verification. Uses an existing Alpine image; no student labs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import { unzipSync, strFromU8 } from 'fflate';
import { createComposeLab } from '../src/labs/compose.js';
import { exportWorkspaces } from '../src/workspaces.js';
const exec = promisify(execFile);
const docker = new Docker();
for (const count of [1, 5]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'net412-docker-export-'));
  const project = `net412-export-test-${process.pid}-${count}`;
  const targets = Array.from({length:count}, (_,i)=>`host_${i}`);
  const spec = {id:project,tasks:[{id:'test.a'}],environment:{compose_project:project,terminal_targets:targets}};
  const compose = ['compose','-p',project,'-f',path.join(directory,'compose.yaml')];
  try {
    await fs.writeFile(path.join(directory,'Dockerfile'), 'FROM alpine:latest\nWORKDIR /work\nRUN mkdir -p nested empty && printf initial > .hidden && printf data > nested/source.txt\nCMD ["sleep", "infinity"]\n');
    await fs.writeFile(path.join(directory,'compose.yaml'), 'services:\n' + targets.map(n=>`  ${n}:\n    build: .\n    image: ${project}:local\n    network_mode: none\n`).join(''));
    const lab=createComposeLab(directory,spec);
    await lab.prepareExport();
    assert.equal((await lab.status()).running,false);
    async function check(stage) {
      const destination=path.join(directory,`${stage}.zip`);
      await exportWorkspaces({docker,lab,targets,destination});
      const files=unzipSync(await fs.readFile(destination));
      for(const n of targets) {
        assert.equal(strFromU8(files[`${n}/.hidden`]),'initial');
        assert.ok(files[`${n}/empty/`]);
        if(stage!=='never-started') assert.equal(strFromU8(files[`${n}/student.txt`]),`work-${n}`);
      }
      console.log(`${count} containers: ${stage} ZIP verified`);
    }
    await check('never-started');
    await lab.start();
    for(const n of targets) await exec('docker',['exec',lab.containerName(n),'sh','-c',`printf work-${n} > /work/student.txt`]);
    await check('running');
    await exec('docker',[...compose,'stop']);
    await check('stopped');
  } finally {
    await exec('docker',[...compose,'down','--volumes','--remove-orphans']).catch(()=>{});
    await exec('docker',['image','rm',`${project}:local`]).catch(()=>{});
    await fs.rm(directory,{recursive:true,force:true});
  }
}
