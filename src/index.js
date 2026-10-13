import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { isUnifiedProcessor, unified } from '@astrojs/markdown-remark';
import { Sources } from './source.js';
import { copyeditRehype } from './rehype.js';
import { copyeditAstro } from './astro.js';
import { saveMiddleware } from './server.js';
import { str, resolveLocale } from './generated/strings.js';

/** @param {import('./index.js').CopyeditOptions} [options] @returns {import('astro').AstroIntegration} */
export default function copyedit(options = {}) {
  const token = randomBytes(32).toString('hex');
  const session = randomBytes(8).toString('hex');
  let sources, endpoint, cacheDir, server;
  let enabled = false;
  const locale = resolveLocale(options.locale);
  return {
    name: 'astro-copyedit',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, addDevToolbarApp }) => {
        if (command !== 'dev') return;
        enabled = true;
        endpoint = `${config.base.replace(/\/$/, '')}/__copyedit__/save`;
        const root = fileURLToPath(config.root);
        sources = new Sources({
          root,
          roots: options.roots?.map(path => resolve(root, path)) ?? [fileURLToPath(config.srcDir)],
          onSource: (path, target) => server?.watcher.add([path, target]),
        });
        const processor = config.markdown.processor;
        if (!isUnifiedProcessor(processor)) throw new Error(str.unsupportedProcessor(locale));
        // Content collections persist rendered HTML. A fresh dev-only cache keeps
        // session IDs valid after restart and prevents instrumentation in builds.
        cacheDir = new URL(`copyedit/${session}/`, config.cacheDir);
        updateConfig({
          cacheDir,
          markdown: { processor: unified({
            ...processor.options,
            // A serializable option invalidates the content-layer digest on
            // restart. URL cache paths alone serialize as {} in Astro's digest.
            rehypePlugins: [...processor.options.rehypePlugins, [copyeditRehype(sources), { session }]],
          }) },
          vite: { plugins: [copyeditAstro(sources), {
            name: 'astro-copyedit:client-config',
            resolveId(id) { if (id === 'virtual:astro-copyedit/config') return '\0virtual:astro-copyedit/config'; },
            load(id) {
              if (id === '\0virtual:astro-copyedit/config') return `export default ${JSON.stringify({ endpoint, token, locale: options.locale ?? null })};`;
            },
          }] },
        });
        addDevToolbarApp({ id: 'astro-copyedit', name: str.name(locale), icon: 'copy', entrypoint: new URL('./toolbar.js', import.meta.url) });
      },
      'astro:server:setup': ({ server: devServer, refreshContent, logger }) => {
        if (!enabled) return;
        server = devServer;
        server.middlewares.use(saveMiddleware({ endpoint, token, sources, afterSave: async ({ changed, path }) => {
          if (changed && path.endsWith('.md') && refreshContent) await refreshContent({ loaders: ['glob-loader', 'starlight-docs-loader'] });
        } }));
        logger.info(str.serverReady(locale));
      },
      'astro:server:done': async () => {
        if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
      },
    },
  };
}
