import { cp, mkdir, rm, symlink } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
export const sites = new URL('.test-sites/', root);
export async function prepareSite(name) {
  const target = new URL(`${name}/`, sites);
  await mkdir(sites, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(new URL(name === 'demo' ? 'demo/' : 'examples/starlight/', root), target, {
    recursive: true,
    filter: source => !/(?:^|[/\\])(?:node_modules|\.astro|dist)(?:[/\\]|$)/.test(source),
  });
  // The copied demo keeps its relative imports of localized interface strings.
  await symlink(new URL('src/', root), new URL('src', sites), 'dir').catch(error => { if (error.code !== 'EEXIST') throw error; });
  return target;
}
