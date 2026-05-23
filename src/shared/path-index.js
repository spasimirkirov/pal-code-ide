export const normalizeIndexPath = (value) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .trim()
    .toLowerCase();

export const buildPathIndexFromTree = (tree) => {
  const files = new Set();
  const directories = new Set(['']);

  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const normalized = normalizeIndexPath(node?.path);
      if (!normalized) continue;
      if (node?.isDirectory) {
        directories.add(normalized);
        walk(node?.children);
      } else {
        files.add(normalized);
      }
    }
  };

  walk(tree);
  return { ready: true, files, directories };
};
