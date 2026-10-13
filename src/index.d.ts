import type { AstroIntegration } from 'astro';
export interface CopyeditOptions {
  /** Editable source folders, relative to the Astro project root. Defaults to srcDir.
   * Symlink targets must also be within an allowed folder. */
  roots?: string[];
  /** Editor language. Defaults to the browser language, then English. */
  locale?: 'en' | 'es';
  /** Toggle the editor. Default: 'Mod+Shift+E' (Cmd on macOS, Ctrl elsewhere).
   * Chords accept Mod/Ctrl/Meta/Alt/Shift + a letter, digit, or F1–F12.
   * Set false to disable the shortcut. */
  shortcut?: string | false;
}
export default function copyedit(options?: CopyeditOptions): AstroIntegration;
