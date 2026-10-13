const excluded = new Set(['pre', 'code', 'script', 'style', 'textarea', 'select', 'option', 'svg', 'math', 'button']);

/** Instrument final, unchanged Markdown text leaves; never infer transformed ranges. */
export function copyeditRehype(sources) {
  return function plugin() {
    return async (tree, file) => {
      if (!file.path?.toLowerCase().endsWith('.md')) return;
      const register = await sources.prepare(file.path, String(file.value));
      if (!register) return;
      function visit(parent) {
        if (!parent.children || excluded.has(parent.tagName) || parent.properties?.dataCopyeditIgnore !== undefined || parent.properties?.['data-copyedit-ignore'] !== undefined) return;
        parent.children = parent.children.map(node => {
          if (node.type === 'text') {
            const mapping = register(node);
            if (mapping) return {
              type: 'element', tagName: 'span',
              properties: { 'data-copyedit-id': mapping.id, 'data-copyedit-source': mapping.source },
              children: [node],
            };
          } else visit(node);
          return node;
        });
      }
      visit(tree);
    };
  };
}
