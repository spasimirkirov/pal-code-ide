export const DEFAULT_CHAT_SESSION_ID = 'default';

export const CHAT_HISTORY_WINDOW = 8;
export const MAX_CONTEXT_TOKENS = 16000;
export const AUTO_CONTEXT_MAX_FILES = 4;
export const AUTO_CONTEXT_MAX_CHARS = 14000;
export const PROJECT_CONTEXT_MAX_LINES = 180;

export const AUTO_APPROVAL_STORAGE_KEY = 'pal-chat-auto-approval-mode';

export const SYSTEM_PROMPT =
    'You are the core AI engine of PAL IDE. Answer the user\'s question using your knowledge.';

export const EDIT_SYSTEM_PROMPT = [
    'You are a code editing agent. Output SEARCH/REPLACE blocks to implement the requested changes.',
    '',
    'Format for edits:',
    'FILE: <path>',
    '<<<<<<< SEARCH',
    '<exact content to replace>',
    '=======',
    '<new content>',
    '>>>>>>> REPLACE',
    '',
    'Format for new files:',
    'CREATE: <path>',
    '<<<<<<< SEARCH',
    '',
    '=======',
    '<file content>',
    '>>>>>>> REPLACE',
    '',
    'Format for deletions:',
    'DELETE: <path>',
    '',
    'The SEARCH content must match the file exactly. Include surrounding context for uniqueness.',
    'No tool calls. No explanations. Only output SEARCH/REPLACE blocks above.',
].join('\n');

export const FILE_REFERENCE_REGEX = /(?:^|[\s"'`(])([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)/g;
export const PROJECT_CONTEXT_HINT_REGEX =
    /(project|workspace|repo|repository|codebase|folder|files|structure|what\s+can\s+you\s+see|what'?s\s+in\s+our\s+project)/i;
export const FILE_CONTEXT_HINT_REGEX =
    /(review|inspect|analy[sz]e|check|fix|update|change|edit|refactor|route|read|open|file)/i;

export const defaultAiSettings = {
    engine: 'lm-studio',
    roleMappings: {
        coding: '',
        vision: '',
        autocomplete: '',
    },
    lmStudio: {
        endpointUrl: 'http://localhost:1234',
        port: '1234',
        activeModel: '',
    },
    orchestrator: {
        maxSteps: 12,
    },

};