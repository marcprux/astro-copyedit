import { parse } from '@astrojs/compiler-rs';
import { decodeHTML } from 'entities';
import MagicString from 'magic-string';
import { EditError } from './errors.js';

const excluded = new Set(['head', 'script', 'style', 'pre', 'code', 'textarea', 'select', 'option', 'svg', 'math', 'button', 'title']);
const containers = new Set(['a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'caption', 'cite', 'dd', 'del', 'details', 'dfn', 'div', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'i', 'ins', 'label', 'li', 'main', 'mark', 'nav', 'p', 'q', 's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'td', 'th', 'time', 'u']);
function attributeName(attribute) {
  const name = attribute.name;
  return name?.type === 'JSXNamespacedName' ? `${name.namespace.name}:${name.name.name}` : name?.name;
}
function tree(source) {
  const result = parse(source);
  if (result.diagnostics.some(diagnostic => diagnostic.severity === 1)) throw new EditError('structure');
  return result.ast;
}

/** Only literal template leaves in HTML containers; never guess expression provenance. */
export function astroTextLeaves(source) {
  const leaves = [];
  function visit(node, editable = false) {
    if (node.type === 'JSXText') {
      if (editable && node.value.trim() && source.slice(node.start, node.end) === node.value && decodeHTML(node.value) === node.value) leaves.push(node);
    } else if (node.type === 'JSXElement') {
      const opening = node.openingElement;
      const name = opening.name.name;
      if (excluded.has(name) || opening.attributes.some(attribute => {
        const name = attributeName(attribute);
        return name === 'data-copyedit-ignore' || name === 'is:raw' || name?.startsWith('set:') || name?.startsWith('client:');
      })) return;
      for (const child of node.children) visit(child, containers.has(name));
    } else if (node.type === 'JSXFragment') {
      for (const child of node.children) visit(child, editable);
    }
  }
  for (const node of tree(source).body) visit(node);
  return leaves;
}
function comparable(ast) {
  return JSON.stringify(ast, (key, value) => {
    if (['start', 'end', 'raw'].includes(key)) return undefined;
    if (value?.type === 'JSXText') return { ...value, value: decodeHTML(value.value) };
    return value;
  });
}
export function patchAstroText(source, start, end, text) {
  if (typeof text !== 'string' || !text.isWellFormed() || [...text].some(char => { const code = char.charCodeAt(0); return code < 9 || (code > 10 && code < 32) || code === 127; })) throw new EditError('invalidText');
  if (text.length > 16_384) throw new EditError('tooLarge', 413);
  const leaf = astroTextLeaves(source).find(node => node.start === start && node.end === end);
  if (!leaf) throw new EditError('structure');
  const old = leaf.value;
  if (text === old) return source;
  if (!text.trim()) throw new EditError('structure');
  let prefix = 0, suffix = 0;
  while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix++;
  while (suffix < old.length - prefix && suffix < text.length - prefix && old[old.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  const inserted = text.slice(prefix, text.length - suffix);
  if (/[\r\n]/.test(inserted + old.slice(prefix, old.length - suffix))) throw new EditError('invalidText');
  const escaped = inserted.replace(/[&<>{}]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '{': '&#123;', '}': '&#125;' })[character]);
  const next = source.slice(0, start + prefix) + escaped + source.slice(end - suffix);
  const expected = tree(source);
  function replace(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXText' && node.start === start && node.end === end) node.value = text.replace(/&/g, '&amp;');
    else for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(replace);
      else if (value && typeof value === 'object') replace(value);
    }
  }
  replace(expected);
  if (comparable(expected) !== comparable(tree(next))) throw new EditError('structure');
  return next;
}

export function copyeditAstro(sources) {
  return {
    name: 'astro-copyedit:astro-text',
    enforce: 'pre',
    // Astro's compiler also runs as a pre plugin. Hook order ensures it sees
    // instrumented template source, with a sourcemap back to the original file.
    transform: {
      order: 'pre',
      async handler(code, id) {
        if (!id.endsWith('.astro') || id.includes('/node_modules/')) return;
        const register = await sources.prepareAstro(id, code);
        if (!register) return;
        const output = new MagicString(code);
        for (const node of astroTextLeaves(code)) {
          const mapping = register(node);
          if (!mapping) continue;
          const label = mapping.source.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);
          output.appendLeft(node.start, `<span data-copyedit-id="${mapping.id}" data-copyedit-source="${label}" data-copyedit-format="astro">`);
          output.appendLeft(node.end, '</span>');
        }
        if (!output.hasChanged()) return;
        return { code: output.toString(), map: output.generateMap({ source: id, includeContent: true, hires: true }) };
      },
    },
  };
}
