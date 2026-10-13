import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

export const collections = {
  articles: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/articles' }) }),
};
