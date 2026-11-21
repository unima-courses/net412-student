import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
async function docker(args, timeout = 30000) {
  return (await exec('docker', args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
}

export function createComposeLab(labDir, spec, { runDocker = docker } = {}) {
  const activityId = spec.id;
  const project = spec.environment.compose_project || `net412-${activityId}`;
  const targets = new Set(spec.environment.terminal_targets || []);
  const capture = spec.environment.capture;
  const requestSource = spec.environment.http_request?.source;
  if (requestSource && (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(requestSource) || !spec.topology?.devices?.some(d => d.name === requestSource))) throw new Error('Invalid HTTP request source');
  if (capture && (!targets.has(capture.target) || typeof capture.path !== 'string' ||
      !/^\/work\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.pcap$/.test(capture.path))) {
    throw new Error('Capture must name a terminal target and a .pcap file under /work');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project) || !targets.size ||
      [...targets].some(target => !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(target))) {
    throw new Error('Generic Compose activity has an invalid project name or terminal target');
  }
  const compose = ['compose', '-p', project, '-f', path.join(labDir, 'compose.yaml')];
  let busy = false;
  async function guarded(action) {
    if (busy) throw new Error('Another lab action is running');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  return {
    id: 'compose',
    actions: new Set(['start', 'reset', ...(requestSource ? ['send-request'] : [])]),
    taskIds: new Set(spec.tasks.map(task => task.id)),
    terminalTargets: targets,
    terminalSessionLimit: Number.isInteger(spec.environment.terminal_session_limit) && spec.environment.terminal_session_limit > 0 ? spec.environment.terminal_session_limit : Infinity,
    containerName: target => `${project}-${target}-1`,
    directory: labDir,
    captureTarget: capture?.target,
    ...(capture ? {
      async exportPcap(targetPath) {
        const container = `${project}-${capture.target}-1`;
        try {
          await runDocker(['exec', container, 'tcpdump', '-nn', '-r', capture.path, '-c', '1']);
          await runDocker(['cp', `${container}:${capture.path}`, targetPath]);
        } catch {
          throw Object.assign(new Error('No valid PCAP is available. Start tcpdump in a terminal, generate traffic, then stop it with Ctrl+C before downloading.'), { status: 409 });
        }
      },
    } : {}),
    ...(requestSource ? {
      'send-request': () => guarded(async () => {
        try { await runDocker(['exec', `${project}-${requestSource}-1`, 'python', '/opt/lab/request.py'], 15000); }
        catch { throw Object.assign(new Error('Request failed. Check that the lab is running and try again.'), {status:409}); }
        return {message:'Request sent'};
      }),
    } : {}),
    async exportTargets() {
      return (await runDocker([...compose, 'config', '--services'])).split('\n').filter(Boolean);
    },
    assertWorkspaceOwner(details) {
      const owner = details.Config?.Labels?.['com.docker.compose.project.working_dir'];
      if (!owner || path.resolve(owner) !== path.resolve(labDir)) throw new Error('These containers belong to another activity or student. Export that work from its own activity before switching labs.');
    },
    prepareExport: () => guarded(async () => {
      // Create missing containers without starting or replacing any existing work.
      await runDocker([...compose, 'create', '--build', '--no-recreate'], 600000);
    }),
    async status() {
      try {
        const running = new Set((await runDocker([...compose, 'ps', '--status', 'running', '--services'])).split('\n').filter(Boolean));
        if (![...targets].every(target => running.has(target))) return { running: false };
        const directories = (await runDocker(['inspect', '--format',
          '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}',
          ...[...targets].map(target => `${project}-${target}-1`)])).split('\n');
        return { running: directories.length === targets.size && directories.every(directory => path.resolve(directory) === path.resolve(labDir)) };
      } catch {
        return { running: false };
      }
    },
    start: () => guarded(async () => {
      await runDocker([...compose, 'up', '--build', '-d', '--wait'], 600000);
      return { message: 'The assigned lab containers are running.' };
    }),
    reset: () => guarded(async () => {
      await runDocker([...compose, 'down', '--volumes', '--remove-orphans'], 120000);
      return { message: 'The assigned lab containers and network were removed.' };
    }),
    evidenceFor(taskId) {
      if (!this.taskIds.has(taskId)) throw new Error('Unknown task');
      return {};
    },
  };
}
