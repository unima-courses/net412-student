import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import tar from 'tar-stream';

function relativeEntry(name) {
  const clean = name.replace(/^\.\//, '').replace(/\/$/, '');
  if (!clean || clean === '.') return '';
  if (clean.startsWith('/') || clean.includes('\\') || clean.split('/').some(part => part === '..')) throw new Error('Container archive contains an unsafe file path');
  return clean;
}
export function workspaceFilename(username, task) {
  const safe = value => String(value).replace(/[^A-Za-z0-9._@+-]/g, '_').slice(0, 100);
  return `${safe(username)}-${safe(task)}.zip`;
}

/** Streams Docker's tar archives into one ZIP without extracting onto the host. */
export async function exportWorkspaces({ docker, lab, targets, destination, directories = {} }) {
  const sources = [];
  try {
    // Preflight all devices before producing an archive; never silently omit a device.
    for (const target of targets) {
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(target)) throw new Error('Invalid topology container name');
      const container = docker.getContainer(lab.containerName(target));
      const details = await container.inspect();
      const directory = directories[target] || details.Config?.WorkingDir || '/work';
      if (!directory.startsWith('/') || path.posix.normalize(directory) === '/' || directory.includes('\0')) throw new Error(`Invalid work directory for ${target}`);
      try {
        const source = { target, stream: await container.getArchive({ path: `${directory.replace(/\/$/, '')}/.` }) };
        source.stream.on('error', error => { source.error = error; });
        sources.push(source);
      } catch (error) {
        throw new Error(`Cannot download ${target}'s work directory (${directory}). Start the lab and ensure the directory exists.`, { cause: error });
      }
    }
    const output = fs.createWriteStream(destination, { mode: 0o600 });
    const zip = new ZipArchive({ zlib: { level: 6 } });
    let failure;
    zip.on('error', error => { failure = error; output.destroy(error); });
    zip.on('warning', error => { failure = error; zip.abort(); output.destroy(error); });
    const completion = finished(output);
    // Attach the rejection handler immediately while the inputs are still being processed.
    completion.catch(() => {});
    zip.pipe(output);
    try {
      for (const source of sources) {
        if (source.error) throw source.error;
        const { target, stream } = source;
        zip.append(Buffer.alloc(0), { name: `${target}/`, type: 'directory' });
        const extract = tar.extract();
        extract.on('entry', (header, body, next) => {
          body.on('error', error => extract.destroy(error));
          try {
            const relative = relativeEntry(header.name);
            if (!relative) { body.resume(); body.on('end', next); return; }
            const name = `${target}/${relative}`;
            if (header.type === 'directory') {
              zip.append(Buffer.alloc(0), { name: `${name}/`, type: 'directory' });
              body.resume();
            } else if (header.type === 'symlink' || header.type === 'link') {
              // Keep link information without following links outside the work directory.
              zip.append(Buffer.from(`Link target: ${header.linkname}\n`), { name: `${name}.link.txt` });
              body.resume();
            } else if (header.type === 'file') {
              zip.append(body, { name, mode: header.mode, date: header.mtime });
            } else { throw new Error(`Unsupported workspace entry: ${header.name}`); }
            body.on('end', next);
          } catch (error) { body.resume(); extract.destroy(error); }
        });
        stream.on('error', error => extract.destroy(error));
        stream.pipe(extract);
        await finished(extract);
        if (failure) throw failure;
      }
      await zip.finalize();
      await completion;
    } catch (error) {
      zip.abort(); output.destroy();
      await completion.catch(() => {});
      throw error;
    }
  } finally {
    for (const source of sources) source.stream.destroy();
  }
}
