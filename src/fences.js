// Wrap verified Markdown code nodes before Shiki/Expressive Code replace their
// HAST and discard source positions. The wrapper survives highlighting; never
// match rendered code by its text or ordinal position.
export function copyeditFences(sources) {
  return function plugin() {
    return async (tree, file) => {
      if (!/\.mdx?$/i.test(file.path ?? '')) return;
      const register = await sources.prepare(file.path, String(file.value));
      if (!register) return;
      const format = file.path.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md';
      function visit(parent) {
        const properties = parent.data?.hProperties;
        if (!parent.children || properties?.dataCopyeditIgnore !== undefined || properties?.['data-copyedit-ignore'] !== undefined ||
          parent.attributes?.some(a => a.type === 'mdxJsxAttribute' && (a.name === 'data-copyedit-ignore' || a.name === 'is:raw' || a.name?.startsWith('client:') || a.name?.startsWith('set:')))) return;
        parent.children = parent.children.map(node => {
          if (node.type === 'code') {
            const mapping = register.fence(node);
            if (mapping) return {
              type: 'copyeditCodeBlock',
              data: { hName: 'div', hProperties: {
                'data-copyedit-code-id': mapping.id,
                'data-copyedit-id': mapping.id,
                'data-copyedit-raw': 'true',
                'data-copyedit-source': mapping.source,
                'data-copyedit-format': format,
              } },
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
