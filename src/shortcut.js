const modifiers = new Map([
  ['mod', 'mod'], ['ctrl', 'ctrl'], ['control', 'ctrl'], ['meta', 'meta'], ['cmd', 'meta'], ['command', 'meta'],
  ['alt', 'alt'], ['option', 'alt'], ['shift', 'shift'],
]);
/** Parse a configurable chord without depending on the browser or OS. */
export function parseShortcut(value = 'Mod+Shift+E') {
  if (value === false) return false;
  if (typeof value !== 'string') throw new TypeError();
  const parts = value.split('+').map(s => s.trim().toLowerCase());
  const result = { mod: false, ctrl: false, meta: false, alt: false, shift: false };
  for (const part of parts) {
    const modifier = modifiers.get(part);
    if (modifier) {
      if (result[modifier]) throw new TypeError();
      result[modifier] = true;
    } else {
      if (result.key || !/^(?:[a-z0-9]|f(?:[1-9]|1[0-2]))$/.test(part)) throw new TypeError();
      result.key = part;
    }
  }
  if (!result.key || (result.mod && (result.ctrl || result.meta)) ||
    (!result.mod && !result.ctrl && !result.meta && !result.alt && !/^f\d+$/.test(result.key))) throw new TypeError();
  return result;
}
export function matchesShortcut(event, shortcut, mac) {
  return Boolean(shortcut && !event.repeat && !event.isComposing && !event.getModifierState?.('AltGraph') &&
    event.key.toLowerCase() === shortcut.key &&
    event.ctrlKey === (shortcut.ctrl || (shortcut.mod && !mac)) &&
    event.metaKey === (shortcut.meta || (shortcut.mod && mac)) &&
    event.altKey === shortcut.alt && event.shiftKey === shortcut.shift);
}
export function shortcutLabel(shortcut, mac) {
  if (!shortcut) return '';
  return [shortcut.ctrl || (shortcut.mod && !mac) ? 'Ctrl' : '', shortcut.meta || (shortcut.mod && mac) ? '⌘' : '',
    shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '', shortcut.key.toUpperCase()].filter(Boolean).join('+');
}
