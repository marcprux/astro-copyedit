import config from 'virtual:astro-copyedit/config';
import { str, resolveLocale } from './generated/strings.js';
import panelCss from './client.css?inline';
import './highlights.css';

const key = 'astro-copyedit:enabled';
let enabled = false;
try { enabled = sessionStorage.getItem(key) === 'true'; } catch { /* Storage may be disabled. */ }
let locale = resolveLocale(config.locale ?? navigator.language);
let active = null;
let saving = false;
let cancelledWithEscape = false;
const pendingReloads = [];
let editor, sourceLabel, shortcut, status, saveButton, cancelButton;

function element(tag, parent, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function message(code, args) { return (Object.hasOwn(str, code) ? str[code] : str.errorUnknown)(locale, args); }
function setStatus(code, error = false) {
  status.textContent = message(code);
  status.dataset.error = String(error);
}
function updateLabels() {
  if (!editor) return;
  editor.setAttribute('aria-label', str.name(locale));
  saveButton.textContent = saving ? str.saving(locale) : active?.node.dataset.copyeditFormat === 'astro' ? str.saveAstro(locale) : active?.node.dataset.copyeditFormat === 'mdx' ? str.saveMdx(locale) : str.save(locale);
  cancelButton.textContent = str.cancel(locale);
  shortcut.textContent = str.shortcut(locale);
  if (active) sourceLabel.textContent = str.editing(locale, { source: active.node.dataset.copyeditSource });
}
function markEditable() {
  document.documentElement.toggleAttribute('data-copyedit-mode', enabled);
  for (const node of document.querySelectorAll('[data-copyedit-id]')) {
    if (enabled) {
      node.tabIndex = 0;
      node.setAttribute('role', node === active?.node ? 'textbox' : 'button');
      node.setAttribute('aria-label', str.editLabel(locale, { source: node.dataset.copyeditSource }));
    } else {
      node.removeAttribute('tabindex');
      node.removeAttribute('role');
      node.removeAttribute('aria-label');
    }
  }
}
export function setEnabled(value) {
  if (active) return false;
  if (enabled === Boolean(value)) return true;
  enabled = Boolean(value);
  try { sessionStorage.setItem(key, String(enabled)); } catch { /* Optional persistence. */ }
  markEditable();
  updateLabels();
  window.dispatchEvent(new CustomEvent('astro-copyedit:state', { detail: { enabled } }));
  return true;
}
export function isEditing() { return Boolean(active); }
export function isEnabled() { return enabled; }

function finish(restore) {
  if (!active) return;
  const { node, original } = active;
  if (restore) node.textContent = original;
  node.removeAttribute('contenteditable');
  node.removeAttribute('data-copyedit-active');
  node.removeAttribute('aria-multiline');
  active = null;
  saving = false;
  editor.hidden = true;
  markEditable();
  updateLabels();
  node.focus();
  for (const resume of pendingReloads.splice(0)) resume();
}
function begin(node) {
  if (active?.node === node || saving) return;
  if (active) {
    if (active.node.textContent !== active.original) { active.node.focus(); return; }
    finish(true);
  }
  active = { node, original: node.textContent };
  node.setAttribute('contenteditable', 'plaintext-only');
  node.setAttribute('data-copyedit-active', '');
  node.setAttribute('role', 'textbox');
  node.setAttribute('aria-multiline', 'false');
  node.spellcheck = true;
  editor.hidden = false;
  status.textContent = '';
  node.focus();
  updateLabels();
}
async function save() {
  if (!active || saving) return;
  saving = true;
  saveButton.disabled = cancelButton.disabled = true;
  active.node.setAttribute('contenteditable', 'false');
  setStatus('saving');
  updateLabels();
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Copyedit-Token': config.token },
      body: JSON.stringify({ id: active.node.dataset.copyeditId, text: active.node.textContent }),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error, true);
      return;
    }
    setStatus('saved');
    finish(false);
    location.reload();
  } catch { setStatus('errorUnknown', true); }
  finally {
    saving = false;
    saveButton.disabled = cancelButton.disabled = false;
    active?.node.setAttribute('contenteditable', 'plaintext-only');
    updateLabels();
  }
}

export function mountEditor(canvas) {
  const style = element('style', canvas);
  style.textContent = panelCss;
  editor = element('astro-dev-toolbar-window', canvas, 'editor');
  editor.setAttribute('role', 'region');
  editor.hidden = true;
  sourceLabel = element('p', editor, 'source');
  status = element('p', editor, 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const actions = element('div', editor, 'actions');
  saveButton = element('button', actions, 'save');
  saveButton.type = 'button';
  saveButton.addEventListener('click', save);
  cancelButton = element('button', actions, 'cancel');
  cancelButton.type = 'button';
  cancelButton.addEventListener('click', () => finish(true));
  shortcut = element('p', editor, 'shortcut');
  updateLabels();
  markEditable();
  return editor;
}

document.addEventListener('click', event => {
  if (!enabled || !(event.target instanceof Element)) return;
  const node = event.target.closest('[data-copyedit-id]');
  if (!node) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  begin(node);
}, true);
document.addEventListener('keydown', event => {
  if (active && event.key === 'Escape' && !saving) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelledWithEscape = true;
    finish(true);
  }
  else if (active && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
  else if (active && event.key === 'Enter' && event.target === active.node) event.preventDefault();
  else if (enabled && !active && ['Enter', ' '].includes(event.key) && event.target instanceof Element && event.target.matches('[data-copyedit-id]')) {
    event.preventDefault(); begin(event.target);
  }
}, true);
// Astro closes its active app on Escape keyup. Consume the same key that
// cancelled a passage so editing mode remains enabled.
document.addEventListener('keyup', event => {
  if (event.key === 'Escape' && cancelledWithEscape) {
    cancelledWithEscape = false;
    event.stopImmediatePropagation();
  }
}, true);
window.addEventListener('blur', () => { cancelledWithEscape = false; });
document.addEventListener('beforeinput', event => {
  if (event.target === active?.node && ['insertParagraph', 'insertLineBreak'].includes(event.inputType)) event.preventDefault();
});
document.addEventListener('paste', event => {
  if (event.target !== active?.node) return;
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  if (/[\r\n]/.test(text)) { setStatus('invalidText', true); return; }
  // insertText preserves the native contenteditable undo stack in current browsers.
  document.execCommand('insertText', false, text);
});
document.addEventListener('drop', event => { if (event.target === active?.node) event.preventDefault(); });
window.addEventListener('beforeunload', event => {
  if (active && active.node.textContent !== active.original) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('astro-copyedit:locale', event => {
  locale = resolveLocale(event.detail.locale);
  updateLabels(); markEditable();
});
document.addEventListener('astro:page-load', markEditable);
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    if (active) {
      if (!saving) setStatus('externalChange', true);
      // Vite awaits HMR listeners. Hold the reload until the user saves or
      // cancels; the event payload itself is not a cancelable DOM event.
      return new Promise(resolve => pendingReloads.push(resolve));
    }
  });
}
