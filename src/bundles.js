import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function relativeFiles(root, directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) names.push(...await relativeFiles(root, target));
    else names.push(path.relative(root, target).split(path.sep).join('/'));
  }
  return names.sort();
}

export function computeBundleDigest({ activity_id: activityId, version, files }) {
  const manifest = Object.keys(files).sort().map(name => `${name}\0${sha256(files[name])}\0`).join('');
  return sha256(`${activityId}\0${version}\0${manifest}`);
}

export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bundle.activity_id || '') ||
      !Number.isInteger(bundle.version) || bundle.version < 1 || !/^[a-f0-9]{64}$/.test(bundle.digest || '') ||
      !bundle.files || typeof bundle.files !== 'object' || Array.isArray(bundle.files)) {
    throw new Error('Instructor server returned an invalid lab bundle');
  }
  const names = Object.keys(bundle.files);
  if (!names.includes('Dockerfile') || !names.includes('compose.yaml') || names.length > 32) {
    throw new Error('Lab bundle must contain Dockerfile and compose.yaml and no more than 32 files');
  }
  let total = 0;
  for (const name of names) {
    const parts = name.split('/');
    if (name.startsWith('/') || name.includes('\\') || parts.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) {
      throw new Error(`Lab bundle contains an unsafe path: ${name}`);
    }
    if (typeof bundle.files[name] !== 'string') throw new Error(`Lab bundle file is not text: ${name}`);
    total += Buffer.byteLength(bundle.files[name], 'utf8');
  }
  if (total > 1024 * 1024) throw new Error('Lab bundle exceeds the 1 MiB limit');
  if (computeBundleDigest(bundle) !== bundle.digest) throw new Error('Lab bundle digest verification failed');
  return bundle;
}

export async function materializeBundle(bundle, packsDir) {
  validateBundle(bundle);
  await fs.mkdir(packsDir, { recursive: true });
  const directoryName = `${bundle.activity_id}-v${bundle.version}-${bundle.digest.slice(0, 12)}`;
  const destination = path.join(packsDir, directoryName);
  const manifestPath = path.join(destination, '.net412-bundle.json');
  const manifestMatches = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).then(value => value.digest === bundle.digest).catch(() => false);
  const expectedNames = ['.net412-bundle.json', ...Object.keys(bundle.files)].sort();
  const namesMatch = manifestMatches && await relativeFiles(destination).then(names => JSON.stringify(names) === JSON.stringify(expectedNames)).catch(() => false);
  const cached = namesMatch && (await Promise.all(Object.entries(bundle.files).map(async ([name, content]) => {
    const target = path.join(destination, ...name.split('/'));
    return fs.readFile(target, 'utf8').then(value => value === content).catch(() => false);
  }))).every(Boolean);
  if (cached) return { directory: destination, digest: bundle.digest, cached: true };
  await fs.rm(destination, { recursive: true, force: true });

  const temporary = await fs.mkdtemp(path.join(packsDir, `.${bundle.activity_id}-v${bundle.version}-`));
  try {
    for (const [name, content] of Object.entries(bundle.files)) {
      const target = path.join(temporary, ...name.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
    }
    await fs.writeFile(path.join(temporary, '.net412-bundle.json'), JSON.stringify({
      activity_id: bundle.activity_id, version: bundle.version, digest: bundle.digest,
    }), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (error.code === 'EEXIST') {
      const existing = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
      if (existing?.digest === bundle.digest) return { directory: destination, digest: bundle.digest, cached: true };
    }
    throw error;
  }
  return { directory: destination, digest: bundle.digest, cached: false };
}
