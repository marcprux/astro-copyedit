import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const directories = ['../demo/dist/', '../examples/starlight/dist/'].map(path => new URL(path, import.meta.url));
const forbidden = /data-copyedit-id|data-copyedit-source|copyedit-panel|__copyedit__\/save|x-copyedit-token|virtual:astro-copyedit/i;
let count = 0;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) await scan(file);
    else if (/\.(html|js|css|json)$/.test(entry.name)) {
      assert.doesNotMatch(await readFile(file, 'utf8'), forbidden, `Editor content leaked into ${file.pathname}`);
      count++;
    }
  }
}
for (const directory of directories) await scan(directory);
assert(count > 0);
console.log(`Checked ${count} production files: no editor assets, endpoints, or source markers.`);
