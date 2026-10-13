import { decodeHTMLStrict } from 'entities';

const punctuation = [['...', '…'], ['---', '—'], ['--', '–'], ['--', '—'], ['``', '“'], ["''", '”'], ['"', '“'], ['"', '”'], ["'", '‘'], ["'", '’']];

// Each rendered UTF-16 code unit points to its original source interval. Do not
// search for words: repeated words and entity spellings must remain distinct.
export function literalMap(text, start = 0) {
  return Array.from({ length: text.length }, (_, i) => [start + i, start + i + 1]);
}
function transformedMap(input, output, start = 0, typography = false) {
  const result = [];
  let i = 0, j = 0;
  while (i < input.length) {
    let count = 1, value = input[i];
    const rest = input.slice(i);
    if (rest[0] === '\r' && output[j] === '\n') { count = rest[1] === '\n' ? 2 : 1; value = '\n'; }
    else if (typography) {
      const match = punctuation.find(([from, to]) => rest.startsWith(from) && output.startsWith(to, j));
      if (match) { count = match[0].length; value = match[1]; }
    } else if (/^\\[!-/:-@[-`{-~]/.test(rest)) { count = 2; value = rest[1]; }
    else {
      const entity = /^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i.exec(rest)?.[0];
      if (entity && decodeHTMLStrict(entity) !== entity) { count = entity.length; value = decodeHTMLStrict(entity); }
    }
    if (!output.startsWith(value, j)) return null;
    const interval = [start + i, start + i + count];
    for (let k = 0; k < value.length; k++) result.push(interval);
    i += count; j += value.length;
  }
  return j === output.length ? result : null;
}
export function proseMap(raw, parsed, rendered, start) {
  const typography = transformedMap(parsed, rendered, 0, true);
  if (!typography) return undefined; // Unknown plugin transformation: no provenance.
  const decoded = transformedMap(raw, parsed, start);
  if (!decoded) return null; // Verified leaf, but no precise character correspondence.
  return typography.map(([a, b]) => [decoded[a][0], decoded[b - 1][1]]);
}
export function normalizedMap(text, start) {
  return transformedMap(text, text.replace(/\r\n?/g, '\n'), start, true);
}
export function inlineCodeMap(raw, rendered, start) {
  const delimiter = /^`+/.exec(raw)?.[0];
  if (!delimiter || !raw.endsWith(delimiter)) return null;
  let value = '', map = [];
  for (let i = delimiter.length; i < raw.length - delimiter.length; i++) {
    const count = raw.slice(i, i + 2) === '\r\n' ? 2 : 1;
    value += /[\r\n]/.test(raw[i]) ? ' ' : raw[i];
    map.push([start + i, start + i + count]); i += count - 1;
  }
  if (value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value)) { value = value.slice(1, -1); map = map.slice(1, -1); }
  return value === rendered ? map : null;
}
export function sourceSelection(first, last, selection, scope) {
  if (selection === undefined) return undefined;
  if (!selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end < 0 || selection.start > (first.map?.length ?? first.text.length) || selection.end > (last.map?.length ?? last.text.length) || (first === last && selection.end < selection.start)) return null;
  if (!first.map || !last.map || selection.start === first.map.length || selection.end === 0) return undefined;
  const start = first.map[selection.start][0], end = last.map[selection.end - 1][1];
  if (start < scope.start || end > scope.end || start > end) return undefined;
  // Textarea values normalize CRLF; offsets use the same normalized string.
  const offset = position => first.body.slice(scope.start, position).replace(/\r\n?/g, '\n').length;
  return { start: offset(start), end: offset(end) };
}

export function fencedCodeMap(raw, value, start) {
  const lines = [...raw.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter(match => match[0]);
  const content = lines.slice(1, -1);
  const rendered = value.split('\n');
  if (content.length !== rendered.length) return null;
  const map = [];
  for (let i = 0; i < content.length; i++) {
    const line = content[i][0].replace(/[\r\n]+$/, '');
    if (!line.endsWith(rendered[i])) return null;
    const offset = start + content[i].index + line.length - rendered[i].length;
    map.push(...literalMap(rendered[i], offset));
    if (i < content.length - 1) map.push([start + content[i].index + line.length, start + content[i].index + content[i][0].length]);
  }
  return map;
}
