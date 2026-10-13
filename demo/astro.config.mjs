import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import copyedit from 'astro-copyedit';

export default defineConfig({
  integrations: [mdx(), copyedit()],
  markdown: { processor: unified() },
});
