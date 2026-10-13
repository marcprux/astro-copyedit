const excluded = new Set(['pre', 'script', 'style', 'textarea', 'select', 'option', 'svg', 'math', 'button']);

/** Instrument final text using verified Markdown leaves and known transformations. */
export function copyeditRehype(sources) {
  return function plugin() {
    return async (tree, file) => {
      if (!/\.mdx?$/i.test(file.path ?? '')) return;
      const format = file.path.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md';
      const register = await sources.prepare(file.path, String(file.value));
      if (!register) return;
      function visit(parent) {
        if (!parent.children || excluded.has(parent.tagName ?? parent.name) || parent.properties?.dataCopyeditIgnore !== undefined || parent.properties?.['data-copyedit-ignore'] !== undefined) return;
        // JSX children can be literal prose, but never instrument code/raw or
        // hydrated component subtrees. Attributes and expressions are untouched.
        if (parent.attributes?.some(attribute => attribute.type === 'mdxJsxAttribute' &&
          (attribute.name === 'data-copyedit-ignore' || attribute.name === 'is:raw' || attribute.name?.startsWith('client:') || attribute.name?.startsWith('set:')))) return;
        parent.children = parent.children.map(node => {
          if (node.type === 'text') {
            const mapping = register(node);
            if (mapping) return {
              type: 'element', tagName: 'span',
              properties: { 'data-copyedit-id': mapping.id, 'data-copyedit-source': mapping.source, 'data-copyedit-format': format, 'data-copyedit-raw': String(mapping.raw) },
              children: [node],
            };
          } else if (node.type === 'element' && node.tagName === 'code' && node.children?.every(child => child.type === 'text') && node.properties?.dataCopyeditIgnore === undefined && node.properties?.['data-copyedit-ignore'] === undefined) {
            const mapping = register({ position: node.position, value: node.children.map(child => child.value).join('') });
            if (mapping) node.properties = { ...node.properties, 'data-copyedit-id': mapping.id, 'data-copyedit-source': mapping.source, 'data-copyedit-format': format, 'data-copyedit-raw': String(mapping.raw) };
          } else visit(node);
          return node;
        });
      }
      visit(tree);
    };
  };
}
