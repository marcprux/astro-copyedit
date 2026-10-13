import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import copyedit from 'astro-copyedit';

export default defineConfig({
  integrations: [copyedit()],
  markdown: { processor: unified() },
});
