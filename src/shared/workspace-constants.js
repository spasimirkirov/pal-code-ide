export const WORKSPACE_IGNORED_NAMES = new Set(['.git', 'node_modules', '.vite', 'dist', 'out']);

export const WORKSPACE_MAX_TREE_NODES = 12000;

export const WORKSPACE_SEARCH_MAX_RESULTS = 200;

export const WORKSPACE_DIAGNOSTICS_MAX_ISSUES = 200;

export const WORKSPACE_DIAGNOSTICS_MAX_FILES = 120;

export const SEARCH_EXCLUDED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.7z', '.rar', '.gz', '.tar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.dll', '.exe', '.bin', '.dylib',
]);
