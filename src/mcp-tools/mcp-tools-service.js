import { spawn } from 'node:child_process';
import { killProcessTree } from '../shared/process-utils';

const decodeHtml = (input) =>
    input
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

export const createMcpToolsService = ({ getWorkspaceRoot }) => {
    const executeTerminalTool = async ({ command, shell = 'powershell', timeoutMs = 120000 }) => {
        if (!command || typeof command !== 'string') {
            throw new Error('Terminal tool requires a command string.');
        }

        const shellName = String(shell).toLowerCase() === 'cmd' ? 'cmd' : 'powershell';
        const shellCommand =
            shellName === 'cmd'
                ? ['cmd.exe', ['/d', '/c', command]]
                : ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]];

        return new Promise((resolve, reject) => {
            const [execName, args] = shellCommand;
            const child = spawn(execName, args, {
                cwd: getWorkspaceRoot(),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                void killProcessTree(child.pid).finally(() => {
                    reject(new Error(`Terminal command timed out after ${timeoutMs}ms.`));
                });
            }, Math.max(1000, Number(timeoutMs) || 120000));

            child.stdout?.on('data', (data) => {
                stdout += String(data);
            });
            child.stderr?.on('data', (data) => {
                stderr += String(data);
            });

            child.on('error', (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(error);
            });

            child.on('exit', (code) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve({
                    shell: shellName,
                    cwd: getWorkspaceRoot(),
                    command,
                    exitCode: code ?? 1,
                    stdout: stdout.slice(-10000),
                    stderr: stderr.slice(-10000),
                });
            });
        });
    };

    const duckduckgoSearch = async ({ query, maxResults = 6 }) => {
        const q = String(query || '').trim();
        if (!q) {
            throw new Error('DuckDuckGo search requires a query string.');
        }

        const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'PAL-IDE/1.0',
                Accept: 'text/html',
            },
        });

        if (!response.ok) {
            throw new Error(`DuckDuckGo request failed with status ${response.status}`);
        }

        const html = await response.text();
        const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
        const limit = Math.min(Math.max(Number(maxResults) || 6, 1), 12);

        const results = matches.slice(0, limit).map((match, idx) => ({
            title: decodeHtml(match[2]),
            url: decodeHtml(match[1]),
            snippet: decodeHtml(snippets[idx]?.[1] || ''),
        }));

        return {
            query: q,
            resultCount: results.length,
            textBlocks: results.map((item, idx) => `${idx + 1}. ${item.title}\n${item.url}\n${item.snippet}`),
            results,
        };
    };

    return {
        executeTerminalTool,
        duckduckgoSearch,
    };
};
