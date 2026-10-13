import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import copyedit from 'astro-copyedit';
import { str } from '../../src/generated/strings.js';

export default defineConfig({
  site: 'https://example.test',
  markdown: { processor: unified() },
  integrations: [starlight({ title: str.starlightTitle() }), copyedit()],
});
