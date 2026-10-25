import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import tar from 'tar-stream';

function relativeEntry(name) {
  const clean = name.replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean || clean === '.') return '';
  if (clean.startsWith('/') || clean.includes('\\') || clean.includes('\0') || clean.split('/').some(part => part === '..' || part.includes(':'))) throw new Error('Container archive contains an unsafe file path');
  return clean;
}
export function workspaceFilename(registration, activity) {
  const safe = value => String(value).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 100) || 'unknown';
  return `${safe(registration)}_${safe(activity)}.zip`;
}

/** Stage all workspace files on disk first, then ZIP the complete container tree. */
export async function exportWorkspaces({ docker, lab, targets, destination, directories = {} }) {
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'net412-workspaces-'));
  try {
    for (const target of [...new Set(targets)]) {
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(target)) throw new Error('Invalid topology container name');
      const container = docker.getContainer(lab.containerName(target));
      const details = await container.inspect();
      lab.assertWorkspaceOwner?.(details);
      const directory = directories[target] || details.Config?.WorkingDir || '/work';
      if (!directory.startsWith('/') || path.posix.normalize(directory) === '/' || directory.includes('\0')) throw new Error(`Invalid work directory for ${target}`);
      const folder = path.join(staging, target);
      await fsp.mkdir(folder);
      let stream;
      try { stream = await container.getArchive({ path: `${directory.replace(/\/$/, '')}/.` }); }
      catch (error) { throw new Error(`Cannot download ${target}'s work directory (${directory}). Ensure the directory exists.`, { cause: error }); }
      const extract = tar.extract();
      extract.on('entry', (header, body, next) => {
        (async () => {
          const relative = relativeEntry(header.name);
          if (!relative) { body.resume(); return; }
          const filename = path.join(folder, relative);
          await fsp.mkdir(path.dirname(filename), { recursive: true });
          if (header.type === 'directory') {
            await fsp.mkdir(filename, { recursive: true }); body.resume();
          } else if (header.type === 'symlink' || header.type === 'link') {
            await fsp.writeFile(`${filename}.link.txt`, `Link target: ${header.linkname}\n`, { flag: 'wx', mode: 0o600 }); body.resume();
          } else if (header.type === 'file') {
            await pipeline(body, fs.createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
          } else throw new Error(`Unsupported workspace entry: ${header.name}`);
        })().then(() => next(), error => { body.resume(); extract.destroy(error); });
      });
      await pipeline(stream, extract);
    }
    const zip = new ZipArchive({ zlib: { level: 6 } });
    const output = fs.createWriteStream(destination, { mode: 0o600 });
    const completion = pipeline(zip, output);
    completion.catch(() => {});
    zip.on('warning', error => zip.destroy(error));
    try {
      zip.directory(staging, false);
      await zip.finalize();
      await completion;
    } catch (error) {
      zip.abort(); zip.destroy(); output.destroy();
      await completion.catch(() => {});
      throw error;
    }
  } catch (error) {
    await fsp.rm(destination, { force: true });
    throw error;
  } finally { await fsp.rm(staging, { recursive: true, force: true }); }
}
