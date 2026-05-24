export const TOOL_NAME_BY_ACTION_TYPE = {
    'list-files': 'workspace_list_files',
    'ls-dir': 'workspace_ls_dir',
    'read-file': 'workspace_read_file',
    'search-text': 'workspace_search_text',
    'search-paths': 'workspace_search_paths',
    'get-errors': 'workspace_get_errors',
    'create-folder': 'workspace_create_folder',
    'write-file': 'workspace_write_file',
    'patch-file': 'workspace_patch_file',
    'delete-file': 'workspace_delete_file',
    'terminal-command': 'workspace_terminal_command',
    'web-search': 'workspace_web_search',
    'fetch-webpage': 'workspace_fetch_webpage',
    'project-get-metadata': 'project_get_metadata',
    'code-search': 'code_search',
    'code-find-by-type': 'code_find_by_type',
    'code-find-in-file': 'code_find_in_file',
    'patch-search-replace': 'patch_search_replace',
    'patch-unified-diff': 'patch_unified_diff',
    'patch-rollback': 'patch_rollback',
    'validation-run-all': 'validation_run_all',
    'validation-run-build': 'validation_run_build',
    'validation-run-tests': 'validation_run_tests',
};

export const TOOL_APPROVAL_TYPE_BY_ACTION_TYPE = {
    'list-files': 'read-only',
    'ls-dir': 'read-only',
    'read-file': 'read-only',
    'search-text': 'read-only',
    'search-paths': 'read-only',
    'get-errors': 'read-only',
    'create-folder': 'edit',
    'write-file': 'edit',
    'patch-file': 'edit',
    'delete-file': 'edit',
    'terminal-command': 'terminal',
    'web-search': 'external-network',
    'fetch-webpage': 'external-network',
    'project-get-metadata': 'read-only',
    'code-search': 'read-only',
    'code-find-by-type': 'read-only',
    'code-find-in-file': 'read-only',
    'patch-search-replace': 'edit',
    'patch-unified-diff': 'edit',
    'patch-rollback': 'edit',
    'validation-run-all': 'read-only',
    'validation-run-build': 'read-only',
    'validation-run-tests': 'read-only',
};

export const TOOL_EXECUTION_LIMITS = {
    'list-files': {
        maxResultNodes: 15000,
    },
    'ls-dir': {
        maxPathLength: 512,
        maxResultsPage: 500,
    },
    'create-folder': {
        maxPathLength: 512,
    },
    'read-file': {
        maxPathLength: 512,
        maxOutputChars: 8000,
    },
    'search-text': {
        maxQueryChars: 1200,
        minResults: 1,
        maxResults: 200,
    },
    'search-paths': {
        maxPatternChars: 500,
        minResults: 1,
        maxResults: 200,
    },
    'get-errors': {
        maxPathLength: 512,
        maxIssues: 200,
    },
    'write-file': {
        maxPathLength: 512,
        maxContentChars: 500000,
    },
    'patch-file': {
        maxPathLength: 512,
        maxPatchEntries: 80,
        maxFindChars: 20000,
        maxReplaceChars: 20000,
    },
    'delete-file': {
        maxPathLength: 512,
    },
    'terminal-command': {
        maxCommandChars: 8000,
        minTimeoutMs: 1000,
        maxTimeoutMs: 600000,
    },
    'web-search': {
        maxQueryChars: 800,
        minResults: 1,
        maxResults: 12,
    },
    'fetch-webpage': {
        maxUrlLength: 2048,
        maxTextLength: 50000,
        minTimeoutMs: 3000,
        maxTimeoutMs: 60000,
    },
};

export const TOOL_VALIDATION_ERROR_CODE = {
    OK: 'OK',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL',
    INVALID_PAYLOAD: 'INVALID_PAYLOAD',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    INVALID_FIELD_VALUE: 'INVALID_FIELD_VALUE',
    LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
    UNSAFE_OPERATION_BLOCKED: 'UNSAFE_OPERATION_BLOCKED',
    NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
};

const UNSAFE_TERMINAL_PATTERNS = [
    /\brm\s+-rf\s+\//i,
    /\brm\s+-rf\s+~\b/i,
    /\bdel\s+\/f\s+\/s\s+\/q\b/i,
    /\brd\s+\/s\s+\/q\b/i,
    /\bformat\s+[a-z]:/i,
    /\bdiskpart\b[\s\S]*\bclean\b/i,
    /\bmkfs\b/i,
    /\bshutdown\s+\/(s|r)\b/i,
    /\breboot\b/i,
    /\bpoweroff\b/i,
    /\binit\s+0\b/i,
];

const hasUnsafeTerminalPattern = (command) => {
    const text = String(command || '').trim();
    if (!text) {
        return false;
    }
    return UNSAFE_TERMINAL_PATTERNS.some((pattern) => pattern.test(text));
};

const ACTION_TYPE_BY_TOOL_NAME = Object.entries(TOOL_NAME_BY_ACTION_TYPE).reduce((acc, [actionType, toolName]) => {
    acc[toolName] = actionType;
    return acc;
}, {});

// Backward-compatible tool-name aliases. Keep existing workspace_* names intact.
Object.assign(ACTION_TYPE_BY_TOOL_NAME, {
    'read-file': 'read-file',
    workspace_write_int_file: 'write-file',
    write_int_file: 'write-file',
});

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const isAbsoluteLikePath = (value) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(String(value || '').trim());

const failValidation = (code, error, details = {}) => ({
    ok: false,
    code,
    error,
    details,
});

const successValidation = (actionType, normalized) => ({
    ok: true,
    code: TOOL_VALIDATION_ERROR_CODE.OK,
    normalized,
    meta: {
        approvalType: TOOL_APPROVAL_TYPE_BY_ACTION_TYPE[actionType] || 'read-only',
        limits: TOOL_EXECUTION_LIMITS[actionType] || {},
    },
});

const toInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.trunc(parsed);
};

export const WORKSPACE_TOOL_DEFINITIONS = [
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['list-files'],
        description: 'List files and folders in the current workspace before targeting paths.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Short reason for listing files.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['ls-dir'],
        description: 'List a single directory page in the workspace. Good for browsing large folders without loading the full tree.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative directory path (defaults to root).' },
                page: { type: 'integer', minimum: 1, description: 'Page number for paginated listing.' },
                pageSize: { type: 'integer', minimum: 20, maximum: 500, description: 'Items per page (default 200).' },
                summary: { type: 'string', description: 'Short reason for listing this directory.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['read-file'],
        description: 'Read the full content of a workspace file.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to read.' },
                summary: { type: 'string', description: 'Short reason for reading this file.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'read-file',
        description: 'Compatibility alias for workspace_read_file. Read the full content of a workspace file.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to read.' },
                summary: { type: 'string', description: 'Short reason for reading this file.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['search-text'],
        description: 'Search text across workspace files using literal or regex matching.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Text or regex pattern to search for.' },
                isRegex: { type: 'boolean', description: 'Set true to treat query as a regex pattern.' },
                maxResults: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of matches to return.' },
                summary: { type: 'string', description: 'Short reason for running text search.' },
            },
            required: ['query', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['search-paths'],
        description: 'Search workspace files by filename or path pattern using glob-style wildcards (*, **, ?).',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Filename or path pattern. Supports * (any chars except /), ** (any chars including /), ? (single char). Simple substrings also work.' },
                maxResults: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of matching paths to return.' },
                summary: { type: 'string', description: 'Short reason for searching paths.' },
            },
            required: ['pattern', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['get-errors'],
        description: 'Collect syntax diagnostics for a file or for the workspace.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Optional workspace-relative file path. If omitted, scans workspace files.' },
                summary: { type: 'string', description: 'Short reason for collecting diagnostics.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['write-file'],
        description: 'Write full file content to a workspace file.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to write.' },
                content: { type: 'string', description: 'Full file content.' },
                summary: { type: 'string', description: 'Short reason for rewriting the file.' },
            },
            required: ['path', 'content', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['patch-file'],
        description: 'Apply targeted find/replace patches to a workspace file.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to patch.' },
                patches: {
                    type: 'array',
                    description: 'Patch operations with exact find/replace text.',
                    items: {
                        type: 'object',
                        properties: {
                            find: { type: 'string', description: 'Exact text to find.' },
                            replace: { type: 'string', description: 'Replacement text.' },
                        },
                        required: ['find', 'replace'],
                        additionalProperties: false,
                    },
                },
                summary: { type: 'string', description: 'Short reason for patching this file.' },
            },
            required: ['path', 'patches', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['delete-file'],
        description: 'Delete a workspace file or directory.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative path to delete.' },
                summary: { type: 'string', description: 'Short reason for deletion.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['create-folder'],
        description: 'Create a folder (directory) in the workspace. Creates parent directories if they do not exist. Use this instead of terminal-command for folder creation.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative path for the new folder.' },
                summary: { type: 'string', description: 'Short reason for creating this folder.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['terminal-command'],
        description: 'Run a terminal command in the workspace. Requires explicit user approval.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Terminal command string to run.' },
                shell: { type: 'string', enum: ['powershell', 'cmd', 'bash', 'zsh', 'sh'], description: 'Shell runtime.' },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Command timeout in milliseconds.' },
                summary: { type: 'string', description: 'Short reason for the command.' },
            },
            required: ['command', 'shell', 'timeoutMs', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['web-search'],
        description: 'Search the web for external references relevant to the current task.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query.' },
                maxResults: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum number of results.' },
                summary: { type: 'string', description: 'Short reason for the web search.' },
            },
            required: ['query', 'maxResults', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: TOOL_NAME_BY_ACTION_TYPE['fetch-webpage'],
        description: 'Fetch and extract readable text content from a specific URL.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full HTTP or HTTPS URL to fetch.' },
                timeoutMs: { type: 'integer', minimum: 3000, maximum: 60000, description: 'Timeout in milliseconds.' },
                summary: { type: 'string', description: 'Short reason for fetching this URL.' },
            },
            required: ['url', 'summary'],
            additionalProperties: false,
        },
    },
    // ── Layer 1: Project Metadata ──
    {
        type: 'function',
        name: 'project_get_metadata',
        description: 'Get parsed project metadata including package.json dependencies, Electron version, framework, bundler, test runner, build scripts, and config file content (forge.config, vite.config, etc.). Call this first to understand the project ecosystem.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Short reason for requesting project metadata.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    // ── Layer 2: Code Search ──
    {
        type: 'function',
        name: 'code_search',
        description: 'Search indexed code declarations (functions, classes, exports, imports, hooks, variables) across the workspace using AST parsing. Use this to find where a function is defined, what a file exports, or what imports a module uses. Returns declarations with file paths and line numbers.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query — matches against declaration names, types, and file paths.' },
                summary: { type: 'string', description: 'Short reason for searching code.' },
            },
            required: ['query', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'code_find_by_type',
        description: 'Find all indexed declarations of a specific type. Supported types: function, class, hook, import, export-function, export-default, export-variable, export-class, variable.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['function', 'class', 'hook', 'import', 'export-function', 'export-default', 'export-variable', 'export-class', 'variable'], description: 'Declaration type to filter by.' },
                summary: { type: 'string', description: 'Short reason for this search.' },
            },
            required: ['type', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'code_find_in_file',
        description: 'Get all declarations (functions, imports, exports) found in a specific workspace file. Useful when you need a quick overview of what a file contains.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to inspect.' },
                summary: { type: 'string', description: 'Short reason for inspecting this file.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    // ── Layer 3: Precision Patching ──
    {
        type: 'function',
        name: 'patch_search_replace',
        description: 'Apply SEARCH/REPLACE blocks to a workspace file. Each block must contain the EXACT text to find (including indentation) and the new text to replace it with. Format: <<<<<<< SEARCH\\nexact code to find\\n=======\\nreplacement code\\n>>>>>>> REPLACE. Multiple blocks are applied in order. Always create a backup automatically.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to patch.' },
                blocks: { type: 'array', items: { type: 'object', properties: { search: { type: 'string', description: 'Exact text to find in the file.' }, replace: { type: 'string', description: 'Replacement text.' } }, required: ['search', 'replace'] }, description: 'Array of SEARCH/REPLACE blocks to apply in order.' },
                summary: { type: 'string', description: 'Short reason for this patch.' },
            },
            required: ['path', 'blocks', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'patch_unified_diff',
        description: 'Apply a unified diff (patch) to a workspace file. The diff must be in standard unified format with @@ hunks. Use this for more complex changes across multiple sections of a file.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to patch.' },
                diff: { type: 'string', description: 'Unified diff text to apply.' },
                summary: { type: 'string', description: 'Short reason for this diff.' },
            },
            required: ['path', 'diff', 'summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'patch_rollback',
        description: 'Roll back a file to its state before the last patch. Uses the .bak backup created by patch_search_replace or patch_unified_diff.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path to roll back.' },
                summary: { type: 'string', description: 'Short reason.' },
            },
            required: ['path', 'summary'],
            additionalProperties: false,
        },
    },
    // ── Layer 4: Validation ──
    {
        type: 'function',
        name: 'validation_run_all',
        description: 'Run all available validation tools (linter, type checker, build) in parallel and return results. Use this after modifying code to verify correctness.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Short reason.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'validation_run_build',
        description: 'Run the project build command (npm run build) and capture output. Returns the full build log including any errors.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Short reason.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'validation_run_tests',
        description: 'Run the project test suite (npm run test) and capture results. Optionally specify a single test file to run.',
        strict: true,
        parameters: {
            type: 'object',
            properties: {
                testFile: { type: 'string', description: 'Optional: workspace-relative test file path to run a single test file.' },
                summary: { type: 'string', description: 'Short reason.' },
            },
            required: ['summary'],
            additionalProperties: false,
        },
    },
];

export const getActionTypeForTool = (toolName) => ACTION_TYPE_BY_TOOL_NAME[String(toolName || '').trim()] || '';

export const getApprovalTypeForActionType = (actionType) =>
    TOOL_APPROVAL_TYPE_BY_ACTION_TYPE[String(actionType || '').trim()] || 'read-only';

export const getExecutionLimitsForActionType = (actionType) =>
    TOOL_EXECUTION_LIMITS[String(actionType || '').trim()] || {};

export const validateAndNormalizeToolArgs = ({ toolName, args }) => {
    const actionType = getActionTypeForTool(toolName);
    if (!actionType) {
        return failValidation(
            TOOL_VALIDATION_ERROR_CODE.UNKNOWN_TOOL,
            `Unknown tool: ${String(toolName || '')}`,
        );
    }

    const payload = asObject(args);
    if (!payload) {
        return failValidation(
            TOOL_VALIDATION_ERROR_CODE.INVALID_PAYLOAD,
            `Tool ${toolName} requires an object payload.`,
        );
    }

    if (actionType === 'list-files') {
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            summary: String(payload.summary || 'List workspace files and folders.'),
        });
    }

    if (actionType === 'ls-dir') {
        const dirPath = String(payload.path || '').trim();
        if (dirPath && dirPath.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`,
                { field: 'path' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path: dirPath || '.',
            page: Math.max(1, toInt(payload.page, 1)),
            pageSize: Math.min(TOOL_EXECUTION_LIMITS[actionType].maxResultsPage, Math.max(20, toInt(payload.pageSize, 200))),
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'create-folder') {
        const path = String(payload.path || '').trim();
        if (!path) {
            return failValidation(TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD, `${toolName}.path is required.`, { field: 'path' });
        }
        if (path.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED, `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`, { field: 'path' });
        }
        if (isAbsoluteLikePath(path)) {
            return failValidation(TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE, `${toolName}.path must be workspace-relative, not absolute.`, { field: 'path' });
        }
        return successValidation(actionType, { type: actionType, path, summary: String(payload.summary || '') });
    }

    if (actionType === 'read-file' || actionType === 'delete-file') {
        const path = String(payload.path || '').trim();
        if (!path) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.path is required.`,
                { field: 'path' },
            );
        }
        if (path.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`,
                { field: 'path' },
            );
        }
        if (isAbsoluteLikePath(path)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.path must be workspace-relative, not absolute.`,
                { field: 'path' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'search-text') {
        const query = String(payload.query || '').trim();
        const isRegex = Boolean(payload.isRegex);
        const maxResults = Math.min(
            TOOL_EXECUTION_LIMITS[actionType].maxResults,
            Math.max(TOOL_EXECUTION_LIMITS[actionType].minResults, toInt(payload.maxResults, 60)),
        );

        if (!query) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.query is required.`,
                { field: 'query' },
            );
        }
        if (query.length > TOOL_EXECUTION_LIMITS[actionType].maxQueryChars) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.query exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxQueryChars} characters.`,
                { field: 'query' },
            );
        }

        if (isRegex) {
            try {
                // Validate pattern shape up front so the model gets deterministic feedback.
                // eslint-disable-next-line no-new
                new RegExp(query);
            } catch {
                return failValidation(
                    TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                    `${toolName}.query is not a valid regex pattern.`,
                    { field: 'query' },
                );
            }
        }

        return successValidation(actionType, {
            type: actionType,
            path: '.',
            query,
            isRegex,
            maxResults,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'search-paths') {
        const pattern = String(payload.pattern || '').trim();
        const maxResults = Math.min(
            TOOL_EXECUTION_LIMITS[actionType].maxResults,
            Math.max(TOOL_EXECUTION_LIMITS[actionType].minResults, toInt(payload.maxResults, 60)),
        );

        if (!pattern) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.pattern is required.`,
                { field: 'pattern' },
            );
        }
        if (pattern.length > TOOL_EXECUTION_LIMITS[actionType].maxPatternChars) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.pattern exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPatternChars} characters.`,
                { field: 'pattern' },
            );
        }

        return successValidation(actionType, {
            type: actionType,
            path: '.',
            pattern,
            maxResults,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'get-errors') {
        const candidatePath = String(payload.path || '').trim();
        if (candidatePath && candidatePath.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`,
                { field: 'path' },
            );
        }
        if (candidatePath && isAbsoluteLikePath(candidatePath)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.path must be workspace-relative, not absolute.`,
                { field: 'path' },
            );
        }

        return successValidation(actionType, {
            type: actionType,
            path: candidatePath || '.',
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'write-file') {
        const path = String(payload.path || '').trim();
        const content = String(payload.content || '');
        if (!path) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.path is required.`,
                { field: 'path' },
            );
        }
        if (path.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`,
                { field: 'path' },
            );
        }
        if (isAbsoluteLikePath(path)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.path must be workspace-relative, not absolute.`,
                { field: 'path' },
            );
        }
        if (content.length > TOOL_EXECUTION_LIMITS[actionType].maxContentChars) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.content exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxContentChars} characters.`,
                { field: 'content' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path,
            content,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'patch-file') {
        const path = String(payload.path || '').trim();
        const patches = Array.isArray(payload.patches) ? payload.patches : [];
        if (!path) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.path is required.`,
                { field: 'path' },
            );
        }
        if (path.length > TOOL_EXECUTION_LIMITS[actionType].maxPathLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.path exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxPathLength}.`,
                { field: 'path' },
            );
        }
        if (isAbsoluteLikePath(path)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.path must be workspace-relative, not absolute.`,
                { field: 'path' },
            );
        }
        if (!patches.length) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.patches must contain at least one patch.`,
                { field: 'patches' },
            );
        }
        if (patches.length > TOOL_EXECUTION_LIMITS[actionType].maxPatchEntries) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.patches exceeds maximum entries of ${TOOL_EXECUTION_LIMITS[actionType].maxPatchEntries}.`,
                { field: 'patches' },
            );
        }

        const normalizedPatches = patches
            .map((entry) => {
                const patch = asObject(entry);
                if (!patch) {
                    return null;
                }
                const find = String(patch.find || '');
                const replace = String(patch.replace || '');
                if (!find.length) {
                    return null;
                }
                if (find.length > TOOL_EXECUTION_LIMITS[actionType].maxFindChars) {
                    return null;
                }
                if (replace.length > TOOL_EXECUTION_LIMITS[actionType].maxReplaceChars) {
                    return null;
                }
                return {
                    find,
                    replace,
                };
            })
            .filter(Boolean);

        if (!normalizedPatches.length) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.patches must include valid find/replace entries.`,
                { field: 'patches' },
            );
        }

        return successValidation(actionType, {
            type: actionType,
            path,
            patches: normalizedPatches,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'terminal-command') {
        const command = String(payload.command || '').trim();
        const shell = String(payload.shell || 'powershell').toLowerCase();
        const allowedShells = new Set(['powershell', 'cmd', 'bash', 'zsh', 'sh']);
        const minTimeout = TOOL_EXECUTION_LIMITS[actionType].minTimeoutMs;
        const maxTimeout = TOOL_EXECUTION_LIMITS[actionType].maxTimeoutMs;
        const timeoutMs = Math.min(maxTimeout, Math.max(minTimeout, toInt(payload.timeoutMs, 120000)));
        if (!command) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.command is required.`,
                { field: 'command' },
            );
        }
        if (command.length > TOOL_EXECUTION_LIMITS[actionType].maxCommandChars) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.command exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxCommandChars} characters.`,
                { field: 'command' },
            );
        }
        if (hasUnsafeTerminalPattern(command)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.UNSAFE_OPERATION_BLOCKED,
                `${toolName}.command was blocked by safety policy because it appears destructive.`,
                { field: 'command' },
            );
        }
        if (!allowedShells.has(shell)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.shell must be one of: powershell, cmd, bash, zsh, sh.`,
                { field: 'shell' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            command,
            shell,
            timeoutMs,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'web-search') {
        const query = String(payload.query || '').trim();
        const maxResults = Math.min(
            TOOL_EXECUTION_LIMITS[actionType].maxResults,
            Math.max(TOOL_EXECUTION_LIMITS[actionType].minResults, toInt(payload.maxResults, 6)),
        );
        if (!query) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.query is required.`,
                { field: 'query' },
            );
        }
        if (query.length > TOOL_EXECUTION_LIMITS[actionType].maxQueryChars) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.query exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxQueryChars} characters.`,
                { field: 'query' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path: 'web',
            query,
            maxResults,
            summary: String(payload.summary || ''),
        });
    }

    if (actionType === 'fetch-webpage') {
        const url = String(payload.url || '').trim();
        const timeoutMs = Math.min(
            TOOL_EXECUTION_LIMITS[actionType].maxTimeoutMs,
            Math.max(TOOL_EXECUTION_LIMITS[actionType].minTimeoutMs, toInt(payload.timeoutMs, 15000)),
        );
        if (!url) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD,
                `${toolName}.url is required.`,
                { field: 'url' },
            );
        }
        if (url.length > TOOL_EXECUTION_LIMITS[actionType].maxUrlLength) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.LIMIT_EXCEEDED,
                `${toolName}.url exceeds maximum length of ${TOOL_EXECUTION_LIMITS[actionType].maxUrlLength} characters.`,
                { field: 'url' },
            );
        }
        if (!/^https?:\/\//i.test(url)) {
            return failValidation(
                TOOL_VALIDATION_ERROR_CODE.INVALID_FIELD_VALUE,
                `${toolName}.url must be a valid HTTP or HTTPS URL.`,
                { field: 'url' },
            );
        }
        return successValidation(actionType, {
            type: actionType,
            path: 'web',
            url,
            timeoutMs,
            summary: String(payload.summary || ''),
        });
    }

    // ── Layer 1: Project Metadata ──
    if (actionType === 'project-get-metadata') {
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            summary: String(payload.summary || 'Get project metadata.'),
        });
    }

    // ── Layer 2: Code Search ──
    if (actionType === 'code-search' || actionType === 'code_search') {
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            query: String(payload.query || ''),
            summary: String(payload.summary || ''),
        });
    }
    if (actionType === 'code-find-by-type' || actionType === 'code_find_by_type') {
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            type: String(payload.type || 'function'),
            summary: String(payload.summary || ''),
        });
    }
    if (actionType === 'code-find-in-file' || actionType === 'code_find_in_file') {
        return successValidation(actionType, {
            type: actionType,
            path: String(payload.path || '.'),
            summary: String(payload.summary || ''),
        });
    }

    // ── Layer 3: Precision Patching ──
    if (actionType === 'patch-search-replace' || actionType === 'patch_search_replace') {
        const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
        if (!blocks.length) {
            return failValidation(TOOL_VALIDATION_ERROR_CODE.MISSING_REQUIRED_FIELD, 'patch_search_replace.blocks is required and must be a non-empty array.');
        }
        return successValidation(actionType, {
            type: actionType,
            path: String(payload.path || ''),
            blocks: blocks.map((b) => ({ search: String(b.search || ''), replace: String(b.replace || '') })),
            summary: String(payload.summary || ''),
        });
    }
    if (actionType === 'patch-unified-diff' || actionType === 'patch_unified_diff') {
        return successValidation(actionType, {
            type: actionType,
            path: String(payload.path || ''),
            diff: String(payload.diff || ''),
            summary: String(payload.summary || ''),
        });
    }
    if (actionType === 'patch-rollback' || actionType === 'patch_rollback') {
        return successValidation(actionType, {
            type: actionType,
            path: String(payload.path || ''),
            summary: String(payload.summary || ''),
        });
    }

    // ── Layer 4: Validation ──
    if (actionType === 'validation-run-all' || actionType === 'validation_run_all') {
        return successValidation(actionType, { type: actionType, path: '.', summary: String(payload.summary || '') });
    }
    if (actionType === 'validation-run-build' || actionType === 'validation_run_build') {
        return successValidation(actionType, { type: actionType, path: '.', summary: String(payload.summary || '') });
    }
    if (actionType === 'validation-run-tests' || actionType === 'validation_run_tests') {
        return successValidation(actionType, {
            type: actionType,
            path: '.',
            testFile: String(payload.testFile || ''),
            summary: String(payload.summary || ''),
        });
    }

    return failValidation(
        TOOL_VALIDATION_ERROR_CODE.NOT_IMPLEMENTED,
        `Tool ${toolName} is not implemented.`,
    );
};
