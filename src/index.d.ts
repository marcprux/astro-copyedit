import type { AstroIntegration } from 'astro';
export interface CopyeditOptions {
  /** Editable source folders, relative to the Astro project root. Defaults to srcDir.
   * Symlink targets must also be within an allowed folder. */
  roots?: string[];
  /** Editor language. Defaults to the browser language, then English. */
  locale?: 'en' | 'es';
}
export default function copyedit(options?: CopyeditOptions): AstroIntegration;
