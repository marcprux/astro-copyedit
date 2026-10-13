import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShortcut, matchesShortcut, shortcutLabel } from '../src/shortcut.js';
const event = extra => ({ key: 'E', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, ...extra });
test('default shortcut uses Cmd on macOS and Ctrl elsewhere with exact modifiers', () => {
  const chord = parseShortcut();
  assert(matchesShortcut(event({ metaKey: true }), chord, true));
  assert(matchesShortcut(event({ ctrlKey: true }), chord, false));
  assert(!matchesShortcut(event({ ctrlKey: true }), chord, true));
  assert(!matchesShortcut(event({ metaKey: true }), chord, false));
  for (const overrides of [{ altKey: true }, { metaKey: true }, { repeat: true }, { isComposing: true }, { shiftKey: false }, { key: 'q' }, { getModifierState: () => true }]) {
    assert(!matchesShortcut(event({ ctrlKey: true, ...overrides }), chord, false));
  }
  assert.equal(shortcutLabel(chord, true), '⌘+Shift+E');
  assert.equal(shortcutLabel(chord, false), 'Ctrl+Shift+E');
});
test('custom shortcuts, modifier aliases, function keys, and disabling are supported', () => {
  assert(matchesShortcut(event({ key: 'k', ctrlKey: true }), parseShortcut('Control+Shift+K'), false));
  assert(matchesShortcut(event({ key: 'k', metaKey: true }), parseShortcut('Command+Shift+K'), true));
  assert(matchesShortcut(event({ key: 'F8', shiftKey: false }), parseShortcut('F8'), false));
  assert(matchesShortcut(event({ key: '7', altKey: true, shiftKey: false }), parseShortcut('Option+7'), false));
  assert.equal(parseShortcut(false), false);
  assert(!matchesShortcut(event({ ctrlKey: true }), false, false));
});
test('invalid or plain typing shortcuts fail configuration validation', () => {
  for (const input of ['', null, true, 4, 'e', 'Shift+e', 'Mod', 'Ctrl+Shift', 'Mod+Ctrl+E', 'Mod+Meta+E', 'Ctrl+Ctrl+E', 'Mod+E+K', 'Mod++E', 'F13', 'Mod+Unknown']) {
    assert.throws(() => parseShortcut(input), TypeError);
  }
});
