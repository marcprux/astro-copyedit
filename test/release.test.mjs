import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../scripts/check-release.mjs';

// Synthetic release metadata; these checks never contact npm or GitHub.
function fixture(version = '1.2.3') {
  return [{ name: 'astro-copyedit', version }, { name: 'astro-copyedit', version, packages: { '': { version } } }];
}
test('matching stable versions can be released', () => {
  assert.equal(checkRelease('v1.2.3', ...fixture(), { stable: true }), '1.2.3');
});
test('tag and both lockfile versions must agree with the package', () => {
  assert.throws(() => checkRelease('v1.2.4', ...fixture()), /package.json/);
  const [manifest, lock] = fixture();
  lock.version = '1.2.2';
  assert.throws(() => checkRelease('v1.2.3', manifest, lock), /package-lock.json/);
  lock.version = '1.2.3'; lock.packages[''].version = '1.2.2';
  assert.throws(() => checkRelease('v1.2.3', manifest, lock), /root package/);
});
test('invalid tag syntax cannot reach release creation', () => {
  for (const tag of ['main', '1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-01', 'v1.2.3-beta..1', 'v1.2.3\n', 'v1.2.3;echo bad']) {
    assert.throws(() => checkRelease(tag, ...fixture()), /semantic versions/);
  }
});
test('SemVer prerelease and build suffixes may create previews but cannot publish to latest', () => {
  for (const version of ['1.2.3-rc.1', '1.2.3-beta', '1.2.3+build.1']) {
    assert.equal(checkRelease(`v${version}`, ...fixture(version)), version);
    assert.throws(() => checkRelease(`v${version}`, ...fixture(version), { stable: true }), /plain vMAJOR/);
  }
});
test('private or unexpected packages cannot be released', () => {
  const [manifest, lock] = fixture();
  assert.throws(() => checkRelease('v1.2.3', { ...manifest, private: true }, lock), /private package/);
  assert.throws(() => checkRelease('v1.2.3', { ...manifest, name: 'unrelated' }, lock), /Unexpected package/);
});
