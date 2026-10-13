import config from 'virtual:astro-copyedit/config';
import { str, resolveLocale } from './generated/strings.js';
import panelCss from './client.css?inline';
import { matchesShortcut, shortcutLabel } from './shortcut.js';

let visible = false;
const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
let locale = resolveLocale(config.locale ?? navigator.language);
let active = null;
let saving = false;
let hiddenWithEscape = false;
let pageSelection = null;
let selectionTimer;
let selecting = false;
let toolbarInteraction = false;
let returnFocus;
const pendingReloads = [];
const spellcheckPreference = 'astro-copyedit:spellcheck';
let editor, sourceLabel, shortcut, status, saveButton, cancelButton, retryButton, sourcePanel, sourceInput, sourceHint, scopeLabel, scopeSelect, spellcheckToggle, spellcheckLabel;
const scopeLabels = {
  fragment: str.sourceFragment, code: str.sourceCodeBlock, paragraph: str.sourceParagraph, heading: str.sourceHeading,
  list: str.sourceList, listItem: str.sourceListItem, blockquote: str.sourceQuote, table: str.sourceTable,
  tableCell: str.sourceCell, html: str.sourceHtmlBlock,
};
function element(tag, parent, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.append(node);
  return node;
}
function setStatus(code, error = false) {
  status.textContent = (Object.hasOwn(str, code) ? str[code] : str.errorUnknown)(locale);
  status.dataset.error = String(error);
}
async function request(payload) {
  const response = await fetch(config.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Copyedit-Token': config.token },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { code: result.error });
  return result;
}
function dirty() { return Boolean(active?.ready && sourceInput.value !== active.sourceBase); }
function updateLabels() {
  if (!editor) return;
  editor.setAttribute('aria-label', str.name(locale));
  saveButton.textContent = saving ? str.saving(locale) : active?.format === 'astro' ? str.saveAstro(locale) : active?.format === 'mdx' ? str.saveMdx(locale) : str.save(locale);
  saveButton.disabled = saving || !active?.ready || Boolean(active?.loading);
  cancelButton.textContent = active ? str.cancel(locale) : str.close(locale);
  cancelButton.disabled = saving;
  retryButton.textContent = str.sourceRetry(locale);
  retryButton.hidden = !active?.retry || Boolean(active?.loading);
  shortcut.textContent = config.shortcut ? str.shortcut(locale, { shortcut: shortcutLabel(config.shortcut, mac) }) : str.shortcutDisabled(locale);
  const code = active?.scopes?.[active.scope]?.type === 'code';
  sourceInput.setAttribute('aria-label', code ? str.sourceCode(locale) : active?.format === 'astro' ? str.sourceHtml(locale) : str.sourceMarkdown(locale));
  sourceInput.disabled = saving || Boolean(active?.loading);
  sourceHint.textContent = code ? str.sourceCodeHint(locale) : str.sourceHint(locale);
  scopeLabel.textContent = str.sourceScope(locale);
  spellcheckLabel.textContent = str.spellcheck(locale);
  for (const option of scopeSelect.options) {
    const scope = active.scopes[Number(option.value)];
    option.textContent = scopeLabels[scope.type](locale, { tag: scope.tag });
  }
  scopeSelect.disabled = saving || Boolean(active?.loading) || dirty();
  if (!active) sourceLabel.textContent = str.name(locale);
  else sourceLabel.textContent = str.editing(locale, { source: active.scopes?.[active.scope]?.source ?? active.nodes[0]?.dataset.copyeditSource ?? str.sourceFragment(locale) });
}
function releaseReloads() { for (const resume of pendingReloads.splice(0)) resume(); }
function clearDraft() {
  active = null;
  sourcePanel.hidden = true;
  sourceInput.value = '';
  scopeSelect.replaceChildren();
  setStatus('selectionEmpty');
  updateLabels();
}
export function canHideEditor() { return !saving; }
export function setVisible(value) {
  value = Boolean(value);
  if (visible === value || (!value && saving)) return;
  visible = value;
  editor.hidden = !visible;
  if (visible) {
    returnFocus = document.activeElement;
    // The toolbar can take focus without retaining the browser's native range.
    // Keep the last page selection; selections inside the panel never replace it.
    const current = selectedRange();
    if (current) pageSelection = current;
    followSelection(true);
  } else {
    if (!dirty() && !active?.loading) { clearDraft(); releaseReloads(); }
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected && !returnFocus.matches('astro-dev-toolbar')) returnFocus.focus({ preventScroll: true });
  }
  window.dispatchEvent(new CustomEvent('astro-copyedit:visibility', { detail: { visible } }));
}
function cancel() {
  if (saving) return;
  clearDraft();
  setVisible(false);
  releaseReloads();
}
function sameSelection(selection) {
  return active && selection && active.error === selection.error && active.offsets?.start === selection.offsets?.start && active.offsets?.end === selection.offsets?.end && active.nodes.length === selection.nodes.length && selection.nodes.every((n, i) => active.nodes[i] === n);
}
function followSelection(focus = false) {
  if (!visible || saving) return;
  if (dirty()) {
    if (!sameSelection(pageSelection)) setStatus('sourceDraft', true);
    if (focus) sourceInput.focus();
    return;
  }
  if (!pageSelection) { clearDraft(); return; }
  if (sameSelection(pageSelection)) {
    active.focusRequested ||= focus;
    if (focus && active.ready) sourceInput.focus();
    return;
  }
  const { nodes, error, offsets } = pageSelection;
  clearDraft();
  active = { nodes, error, offsets, id: nodes[0]?.dataset.copyeditId, format: nodes[0]?.dataset.copyeditFormat, scope: 0, ready: false, focusRequested: focus };
  updateLabels();
  if (error) { setStatus(error, true); if (focus) cancelButton.focus(); }
  else openSource();
}
async function openSource(scope = 0) {
  if (!active || saving || active.loading) return;
  const selection = active;
  selection.loading = true; selection.retry = false;
  setStatus('sourceLoading'); updateLabels();
  try {
    const payload = selection.nodes.length > 1
      ? { operation: 'selection', ids: selection.nodes.map(n => n.dataset.copyeditId), selection: selection.offsets }
      : { operation: 'source', id: selection.id, scope, selection: selection.offsets };
    const result = await request(payload);
    if (active !== selection) return;
    selection.id = result.id ?? selection.id;
    selection.ready = true; selection.scope = scope; selection.scopes = result.scopes;
    scopeSelect.replaceChildren();
    result.scopes.forEach((_, index) => { const option = element('option', scopeSelect); option.value = String(index); });
    scopeSelect.value = String(scope);
    sourceInput.value = result.text;
    if (result.selection) sourceInput.setSelectionRange(result.selection.start, result.selection.end);
    else sourceInput.setSelectionRange(0, 0);
    selection.sourceBase = sourceInput.value;
    sourcePanel.hidden = false;
    status.textContent = '';
  } catch (error) { if (active === selection) { setStatus(error.code ?? 'errorUnknown', true); selection.retry = true; } }
  finally {
    if (active === selection) {
      selection.loading = false;
      scopeSelect.value = String(selection.scope);
      updateLabels();
      if (selection.ready && selection.focusRequested && visible) sourceInput.focus();
    }
  }
}
async function save() {
  if (!active?.ready || saving || active.loading) return;
  saving = true; setStatus('saving'); updateLabels();
  try {
    await request({ id: active.id, text: sourceInput.value, mode: 'source', scope: active.scope });
    saving = false;
    clearDraft(); setVisible(false); releaseReloads(); location.reload();
  } catch (error) { setStatus(error.code ?? 'errorUnknown', true); }
  finally { saving = false; updateLabels(); }
}
export function mountEditor(canvas) {
  element('style', canvas).textContent = panelCss;
  editor = element('astro-dev-toolbar-window', canvas, 'editor expanded');
  editor.setAttribute('role', 'region'); editor.hidden = true;
  sourceLabel = element('p', editor, 'source');
  status = element('p', editor, 'status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  sourcePanel = element('div', editor, 'source-panel'); sourcePanel.hidden = true;
  const row = element('div', sourcePanel, 'scope-row');
  scopeLabel = element('label', row); scopeLabel.htmlFor = 'copyedit-source-scope';
  scopeSelect = element('select', row); scopeSelect.id = 'copyedit-source-scope';
  scopeSelect.addEventListener('change', () => {
    if (dirty()) { scopeSelect.value = String(active.scope); return; }
    openSource(Number(scopeSelect.value));
  });
  const spellcheckControl = element('label', row, 'spellcheck');
  spellcheckToggle = element('input', spellcheckControl); spellcheckToggle.type = 'checkbox';
  spellcheckLabel = element('span', spellcheckControl);
  // Storage can be unavailable in restricted browsing contexts. The control
  // still works for the current page without persisting the preference.
  spellcheckToggle.checked = true;
  try { spellcheckToggle.checked = localStorage.getItem(spellcheckPreference) !== 'false'; } catch { /* Use the default. */ }
  spellcheckToggle.addEventListener('change', () => {
    sourceInput.spellcheck = spellcheckToggle.checked;
    try { localStorage.setItem(spellcheckPreference, String(spellcheckToggle.checked)); } catch { /* Keep the in-memory preference. */ }
  });
  sourceInput = element('textarea', sourcePanel, 'raw-source'); sourceInput.spellcheck = spellcheckToggle.checked;
  sourceInput.addEventListener('input', updateLabels);
  sourceHint = element('p', sourcePanel, 'source-hint');
  const actions = element('div', editor, 'actions');
  saveButton = element('button', actions, 'save'); saveButton.type = 'button'; saveButton.addEventListener('click', save);
  cancelButton = element('button', actions, 'cancel'); cancelButton.type = 'button'; cancelButton.addEventListener('click', cancel);
  retryButton = element('button', actions, 'retry'); retryButton.type = 'button'; retryButton.addEventListener('click', () => openSource(active.scope));
  shortcut = element('p', editor, 'shortcut');
  setStatus('selectionEmpty'); updateLabels(); return editor;
}
function inToolbar(event) {
  return event.composedPath().some(n => n instanceof Element && n.matches('astro-dev-toolbar'));
}
function typing(event) {
  return event.composedPath().some(n => n instanceof Element && n.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
function focusInControl() {
  return document.activeElement?.matches('astro-dev-toolbar, input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
function mapped(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest('[data-copyedit-ignore]') ? null : element?.closest('[data-copyedit-id]');
}
// Inspect every selected text node, not just the endpoints: a range can cross
// imported components or generated content between two otherwise valid leaves.
function selectedRange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return null;
  const range = selection.getRangeAt(0);
  const root = range.commonAncestorContainer;
  if (root.getRootNode() !== document || (root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement)?.closest('astro-dev-toolbar, input, textarea, select, [contenteditable]')) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = root.nodeType === Node.TEXT_NODE ? [root] : [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  const nodes = [];
  let unsupported = false;
  let firstOffset, lastOffset;
  for (const text of texts) {
    if (!range.intersectsNode(text)) continue;
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.length;
    if (!text.data.slice(start, end).trim()) continue;
    // Ignore non-content controls embedded by syntax highlighters.
    if (text.parentElement.closest('button, script, style, [hidden]')) continue;
    const node = mapped(text);
    if (!node) { unsupported = true; continue; }
    // Range lengths count UTF-16 just like textarea selection offsets. Code
    // fences may contain highlighter UI; only their actual code is measured.
    const content = node.querySelector('pre code') ?? node;
    if (!content.contains(text)) { unsupported = true; continue; }
    const prefix = document.createRange();
    prefix.selectNodeContents(content);
    prefix.setEnd(text, start);
    const offset = prefix.toString().length;
    if (firstOffset === undefined) firstOffset = offset;
    lastOffset = offset + end - start;
    if (nodes.at(-1) !== node) nodes.push(node);
  }
  return { nodes, offsets: { start: firstOffset, end: lastOffset }, error: unsupported || !nodes.length ? 'selectionUnmapped' : undefined };
}
function scheduleSelection() {
  // Capture immediately, before a toolbar click or Tab can collapse the range;
  // debounce only the source fetch, and never fetch mid-drag.
  if (!selecting && !focusInControl()) {
    const current = selectedRange();
    // WebKit can clear the native selection on a label/checkbox click without
    // focusing it. A toolbar gesture must not clear the editor's source range.
    if (!current && toolbarInteraction) return;
    pageSelection = current;
  }
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (!selecting && !focusInControl() && visible) followSelection();
  }, 100);
}
// No click interception, page outlines, roles, or tab stops. Track the browser's
// normal selection and wait for a drag/keyboard selection to settle.
document.addEventListener('selectionchange', scheduleSelection);
document.addEventListener('pointerdown', event => {
  toolbarInteraction = inToolbar(event);
  if (toolbarInteraction) {
    const current = selectedRange();
    if (current) pageSelection = current;
  } else if (!typing(event)) selecting = true;
}, true);
document.addEventListener('pointerup', () => { selecting = false; scheduleSelection(); }, true);
document.addEventListener('pointercancel', () => { selecting = false; scheduleSelection(); }, true);
document.addEventListener('keydown', event => {
  if (!editor) return;
  toolbarInteraction = inToolbar(event);
  if (matchesShortcut(event, config.shortcut, mac) && (!typing(event) || inToolbar(event))) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!visible) {
      const current = selectedRange();
      if (current) pageSelection = current;
    }
    setVisible(!visible);
  } else if (visible && event.key === 'Escape' && !event.isComposing) {
    event.preventDefault(); event.stopImmediatePropagation(); hiddenWithEscape = true;
    setVisible(false);
  } else if (visible && inToolbar(event) && event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault(); save();
  }
}, true);
document.addEventListener('keyup', event => {
  if (event.key === 'Escape' && hiddenWithEscape) { hiddenWithEscape = false; event.stopImmediatePropagation(); }
}, true);
window.addEventListener('blur', () => { hiddenWithEscape = false; selecting = false; });
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('astro-copyedit:locale', event => { locale = resolveLocale(event.detail.locale); updateLabels(); });
document.addEventListener('astro:page-load', () => { pageSelection = null; if (!dirty()) clearDraft(); });
if (import.meta.hot) import.meta.hot.on('vite:beforeFullReload', () => {
  if (dirty() || saving) {
    if (!saving) setStatus('externalChange', true);
    return new Promise(resolve => pendingReloads.push(resolve));
  }
});
