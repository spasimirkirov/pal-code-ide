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

    const fetchWebpage = async ({ url, timeoutMs = 15000 }) => {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) {
            throw new Error('fetchWebpage requires a url string.');
        }

        if (!/^https?:\/\//i.test(targetUrl)) {
            throw new Error('fetchWebpage requires a valid HTTP or HTTPS URL.');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(3000, Math.min(60000, Number(timeoutMs) || 15000)));

        try {
            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            const html = await response.text();
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const bodyText = bodyMatch
                ? bodyMatch[1]
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
                    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
                    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&[#a-zA-Z0-9]+;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                : '';

            const maxLength = 50000;
            const content = bodyText.slice(0, maxLength);

            return {
                ok: true,
                url: targetUrl,
                title,
                text: content,
                truncated: bodyText.length > maxLength,
                length: content.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Request timed out after ${timeoutMs}ms.`);
            }
            throw new Error(`Failed to fetch webpage: ${error.message}`);
        } finally {
            clearTimeout(timer);
        }
    };

    return {
        executeTerminalTool,
        duckduckgoSearch,
        fetchWebpage,
    };
};
