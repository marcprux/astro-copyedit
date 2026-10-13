import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const number = '(?:0|[1-9][0-9]*)';
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const tagPattern = new RegExp(`^v(${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$`);

/** Validate the source that will be released before granting publish permissions. */
export function checkRelease(tag, manifest, lock, { stable = false } = {}) {
  const match = typeof tag === 'string' && tagPattern.exec(tag);
  assert(match && match[0] === tag, 'Release tags must be semantic versions prefixed with v, such as v0.2.0.');
  const version = match[1];
  assert.equal(manifest.name, 'astro-copyedit', 'Unexpected package name.');
  assert.notEqual(manifest.private, true, 'A private package cannot be published.');
  assert.equal(manifest.version, version, 'Tag and package.json versions must match exactly.');
  assert.equal(lock.name, manifest.name, 'Lockfile package name must match.');
  assert.equal(lock.version, version, 'Tag and package-lock.json versions must match.');
  assert.equal(lock.packages?.['']?.version, version, 'Lockfile root package version must match.');
  if (stable) assert(!version.includes('-') && !version.includes('+'), 'npm latest releases require a plain vMAJOR.MINOR.PATCH tag; suffixes cannot be promoted.');
  return version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const version = checkRelease(process.env.RELEASE_TAG, manifest, lock, { stable: process.argv.includes('--stable') });
  console.log(`Validated astro-copyedit@${version}`);
}
