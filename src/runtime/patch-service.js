import fs from 'node:fs';
import path from 'node:path';
import * as diffLib from 'diff';

const normalizeInsideRoot = (rootPath, targetPath) => {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Path is outside workspace root.');
    }
    return resolvedTarget;
};

const SEARCH_START = /<<<<<<<\s*SEARCH\s*/;
const DIVIDER = /=======\s*/;
const REPLACE_END = />>>>>>>\s*REPLACE\s*/;

export const createPatchService = ({ getWorkspaceRoot }) => {
    // ── Search-and-Replace Block Parsing ───────────────────────────────

    const parseSearchReplaceBlocks = (text) => {
        const blocks = [];
        const lines = text.split('\n');
        let i = 0;

        while (i < lines.length) {
            if (SEARCH_START.test(lines[i])) {
                const searchLines = [];
                i++;
                while (i < lines.length && !DIVIDER.test(lines[i])) {
                    searchLines.push(lines[i]);
                    i++;
                }
                if (i >= lines.length) break;
                i++; // skip divider

                const replaceLines = [];
                while (i < lines.length && !REPLACE_END.test(lines[i])) {
                    replaceLines.push(lines[i]);
                    i++;
                }

                const search = searchLines.join('\n').replace(/\s+$/, '');
                const replace = replaceLines.join('\n').replace(/\s+$/, '');

                if (search || replace) {
                    blocks.push({ search, replace });
                }
            }
            i++;
        }

        return blocks;
    };

    // Also parse the XML-style format
    const parseXmlBlocks = (text) => {
        const blocks = [];
        const searchRegex = /<SEARCH>([\s\S]*?)<\/SEARCH>/g;
        const replaceRegex = /<REPLACE>([\s\S]*?)<\/REPLACE>/g;
        const searches = [];
        const replaces = [];
        let m;

        while ((m = searchRegex.exec(text)) !== null) searches.push(m[1].trim());
        while ((m = replaceRegex.exec(text)) !== null) replaces.push(m[1].trim());

        const count = Math.min(searches.length, replaces.length);
        for (let i = 0; i < count; i++) {
            blocks.push({ search: searches[i], replace: replaces[i] });
        }
        return blocks;
    };

    const normalizeWhitespace = (str) => str.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');

    const applyBlock = (content, block) => {
        const { search, replace } = block;
        const normalizedContent = normalizeWhitespace(content);
        const normalizedSearch = normalizeWhitespace(search);

        // Exact match first
        const idx = normalizedContent.indexOf(normalizedSearch);
        if (idx !== -1) {
            const before = content.slice(0, idx + (content.length - normalizedContent.length > 0 ? content.indexOf(normalizedSearch) : idx));
            // Actually compute correctly
            const exactIdx = content.indexOf(search);
            if (exactIdx !== -1) {
                return content.slice(0, exactIdx) + replace + content.slice(exactIdx + search.length);
            }
            // Use normalized index
            const beforeContent = content.slice(0, idx);
            const afterContent = content.slice(idx + normalizedSearch.length);
            return beforeContent + replace + afterContent;
        }

        // Try with relaxed whitespace (collapse multiple spaces)
        const relaxedSearch = normalizedSearch.replace(/[ \t]+/g, ' ');
        const relaxedContent = normalizedContent.replace(/[ \t]+/g, ' ');
        const relaxedIdx = relaxedContent.indexOf(relaxedSearch);
        if (relaxedIdx !== -1) {
            // Find the actual content boundaries
            const beforeLen = content.slice(0, relaxedIdx).length;
            const afterStart = content.slice(relaxedIdx);
            const searchLen = normalizedSearch.length;
            return content.slice(0, beforeLen) + replace + content.slice(beforeLen + searchLen);
        }

        // Try with completely stripped whitespace (every whitespace char → single space)
        const strippedSearch = normalizedSearch.replace(/\s+/g, ' ').trim();
        const strippedContent = normalizedContent.replace(/\s+/g, ' ').trim();
        const strippedIdx = strippedContent.indexOf(strippedSearch);
        if (strippedIdx !== -1) {
            return null; // Too risky to auto-fix with significant whitespace changes
        }

        return null;
    };

    const applySearchReplace = ({ filePath: targetPath, blocks }) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, targetPath));
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            return { ok: false, error: `File not found: ${targetPath}` };
        }

        const original = fs.readFileSync(absPath, 'utf-8');
        let content = original;
        const results = [];

        for (const block of blocks) {
            const result = applyBlock(content, block);
            if (result === null) {
                results.push({
                    ok: false,
                    error: 'Search block not found in file. The exact text to replace must match what is in the file.',
                    search: block.search.slice(0, 200),
                });
            } else {
                content = result;
                results.push({ ok: true });
            }
        }

        if (results.every((r) => r.ok)) {
            // Backup original
            fs.copyFileSync(absPath, `${absPath}.bak`);
            fs.writeFileSync(absPath, content, 'utf-8');
            return { ok: true, path: absPath, changes: blocks.length, results };
        }

        return { ok: false, path: absPath, error: 'Some search blocks failed to match.', results };
    };

    const previewPatch = ({ filePath: targetPath, patches }) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, targetPath));
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            return { ok: false, error: `File not found: ${targetPath}` };
        }

        const original = fs.readFileSync(absPath, 'utf-8');
        let content = original;
        const sourcePatches = Array.isArray(patches) ? patches : [];
        const results = [];

        for (const patch of sourcePatches) {
            const search = String(patch?.search ?? patch?.find ?? '');
            const replace = String(patch?.replace ?? '');

            if (!search) {
                results.push({ ok: false, error: 'Patch block is missing search/find text.' });
                continue;
            }

            const next = applyBlock(content, { search, replace });
            if (next === null) {
                results.push({
                    ok: false,
                    error: 'Search block not found in file. The exact text to replace must match what is in the file.',
                    search: search.slice(0, 200),
                });
                continue;
            }

            content = next;
            results.push({ ok: true });
        }

        const diff = diffLib.createTwoFilesPatch(targetPath, targetPath, original, content, '', '');
        const allMatched = results.length > 0 && results.every((r) => r.ok);

        return {
            ok: allMatched,
            path: targetPath,
            diff,
            hasChanges: original !== content,
            results,
        };
    };

    // ── Unified Diff Application ──────────────────────────────────────

    const applyUnifiedDiff = ({ filePath: targetPath, diff }) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, targetPath));
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            return { ok: false, error: `File not found: ${targetPath}` };
        }

        const original = fs.readFileSync(absPath, 'utf-8');
        const parsed = diffLib.parsePatch(diff);

        if (!parsed || parsed.length === 0) {
            return { ok: false, error: 'Could not parse unified diff. Ensure the diff format is correct.' };
        }

        const results = [];
        let content = original;

        for (const patch of parsed) {
            try {
                const result = diffLib.applyPatch(content, patch);
                if (result === false) {
                    results.push({ ok: false, error: 'Unified diff could not be applied (hunk does not match file content).' });
                } else {
                    content = result;
                    results.push({ ok: true });
                }
            } catch (error) {
                results.push({ ok: false, error: String(error?.message || 'Diff apply error.') });
            }
        }

        if (results.every((r) => r.ok)) {
            fs.copyFileSync(absPath, `${absPath}.bak`);
            fs.writeFileSync(absPath, content, 'utf-8');
            return { ok: true, path: absPath, changes: results.length, results };
        }

        return { ok: false, path: absPath, error: 'Some diff hunks failed.', results };
    };

    // ── Unified Diff Creation ─────────────────────────────────────────

    const createUnifiedDiff = ({ filePath: targetPath }) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, targetPath));

        const current = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
        const backup = `${absPath}.bak`;
        const original = fs.existsSync(backup) ? fs.readFileSync(backup, 'utf-8') : '';

        const diff = diffLib.createTwoFilesPatch(targetPath, targetPath, original, current, '', '');
        return { ok: true, path: targetPath, diff, hasChanges: original !== current };
    };

    const rollback = ({ filePath: targetPath }) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, targetPath));
        const backup = `${absPath}.bak`;

        if (!fs.existsSync(backup)) {
            return { ok: false, error: 'No backup found to roll back.' };
        }
        fs.copyFileSync(backup, absPath);
        fs.unlinkSync(backup);
        return { ok: true, path: absPath, rolledBack: true };
    };

    return {
        parseSearchReplaceBlocks,
        parseXmlBlocks,
        applySearchReplace,
        previewPatch,
        applyUnifiedDiff,
        createUnifiedDiff,
        rollback,
    };
};
