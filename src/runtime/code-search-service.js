import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import acornJsx from 'acorn-jsx';
import * as walk from 'acorn-walk';

const PARSER = acorn.Parser.extend(acornJsx());

// Register JSX walkers directly on acorn-walk's base so walk.simple() can traverse JSX files
const registerJsxWalkers = () => {
    const b = walk.base;
    if (b.JSXElement) return; // already registered
    b.JSXElement = (node, st, c) => {
        if (node.openingElement) c(node.openingElement, st);
        if (node.closingElement) c(node.closingElement, st);
        if (node.children) { for (let i = 0; i < node.children.length; i++) c(node.children[i], st); }
    };
    b.JSXOpeningElement = (node, st, c) => {
        if (node.name) c(node.name, st);
        if (node.attributes) { for (let i = 0; i < node.attributes.length; i++) c(node.attributes[i], st); }
    };
    b.JSXClosingElement = (node, st, c) => { if (node.name) c(node.name, st); };
    b.JSXAttribute = (node, st, c) => { if (node.name) c(node.name, st); if (node.value) c(node.value, st); };
    b.JSXText = () => {};
    b.JSXExpressionContainer = (node, st, c) => { if (node.expression) c(node.expression, st); };
    b.JSXFragment = (node, st, c) => {
        if (node.openingFragment) c(node.openingFragment, st);
        if (node.closingFragment) c(node.closingFragment, st);
        if (node.children) { for (let i = 0; i < node.children.length; i++) c(node.children[i], st); }
    };
    b.JSXOpeningFragment = () => {};
    b.JSXClosingFragment = () => {};
    b.JSXSpreadAttribute = (node, st, c) => { if (node.argument) c(node.argument, st); };
    b.JSXIdentifier = () => {};
    b.JSXNamespacedName = (node, st, c) => { if (node.namespace) c(node.namespace, st); if (node.name) c(node.name, st); };
    b.JSXMemberExpression = (node, st, c) => { if (node.object) c(node.object, st); if (node.property) c(node.property, st); };
    b.JSXEmptyExpression = () => {};
};
registerJsxWalkers();

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const IGNORED = new Set(['.git', 'node_modules', '.vite', 'dist', 'out', '.next', '.cache', '__pycache__']);

export const createCodeSearchService = ({ getWorkspaceRoot, workspaceIndex }) => {
    let declIndex = null;

    const parseFile = (absPath) => {
        try {
            const code = fs.readFileSync(absPath, 'utf-8');
            const ast = PARSER.parse(code, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true,
                allowImportExportEverywhere: true,
                allowSuperOutsideMethod: true,
                allowReturnOutsideFunction: true,
            });
            return { ast, code, absPath };
        } catch {
            return null;
        }
    };

    const extractDeclarations = (parsed) => {
        if (!parsed) return [];
        const { ast, code, absPath } = parsed;
        const declarations = [];

        const add = (type, name, line, col, detail) => {
            declarations.push({ type, name, line, col, file: absPath, detail: detail || null });
        };

        walk.simple(ast, {
            ExportNamedDeclaration(node) {
                if (node.declaration) {
                    if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                        add('export-function', node.declaration.id.name, node.declaration.loc.start.line, node.declaration.loc.start.column, formatFnDetail(node.declaration));
                    } else if (node.declaration.type === 'VariableDeclaration') {
                        for (const d of node.declaration.declarations) {
                            if (d.id?.type === 'Identifier') {
                                add('export-variable', d.id.name, d.loc?.start?.line || node.loc.start.line, d.loc?.start?.column || 0, extractInitializer(d));
                            }
                        }
                    } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                        add('export-class', node.declaration.id.name, node.declaration.loc.start.line, node.declaration.loc.start.column, null);
                    }
                }
            },
            ExportDefaultDeclaration(node) {
                if (node.declaration) {
                    if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                        add('export-default', node.declaration.id.name, node.declaration.loc.start.line, node.declaration.loc.start.column, `export default function ${node.declaration.id.name}`);
                    } else if (node.declaration.type === 'Identifier') {
                        add('export-default', node.declaration.name, node.loc.start.line, node.loc.start.column, `export default ${node.declaration.name}`);
                    } else {
                        add('export-default', '(anonymous)', node.loc.start.line, node.loc.start.column, null);
                    }
                }
            },
            FunctionDeclaration(node) {
                if (node.id) {
                    const isAsync = node.async ? 'async ' : '';
                    const isGen = node.generator ? '*' : '';
                    const isArrow = false;
                    const params = node.params.map((p) => p.type === 'Identifier' ? p.name : '...').join(', ');
                    add('function', node.id.name, node.loc.start.line, node.loc.start.column, `${isAsync}function${isGen} ${node.id.name}(${params})`);
                }
            },
            VariableDeclarator(node) {
                if (node.id?.type === 'Identifier') {
                    const init = node.init;
                    // Detect arrow functions
                    if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') {
                        const isAsync = init.async ? 'async ' : '';
                        const params = init.params.map((p) => p.type === 'Identifier' ? p.name : '...').join(', ');
                        add('function', node.id.name, node.loc.start.line, node.loc.start.column, `${isAsync}(${params}) => ...`);
                    } else if (init?.type === 'ClassExpression') {
                        add('class', node.id.name, node.loc.start.line, node.loc.start.column, null);
                    } else if (init?.type === 'Identifier') {
                        add('variable', node.id.name, node.loc.start.line, node.loc.start.column, `= ${init.name}`);
                    } else if (init?.type === 'MemberExpression') {
                        add('variable', node.id.name, node.loc.start.line, node.loc.start.column, `= ${memberExprToString(init)}`);
                    } else if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier') {
                        if (init.callee.name === 'require') {
                            add('import', node.id.name, node.loc.start.line, node.loc.start.column, `require(${init.arguments?.[0]?.value || '?'})`);
                        } else if (/^use[A-Z]/.test(node.id.name)) {
                            add('hook', node.id.name, node.loc.start.line, node.loc.start.column, `${init.callee.name}(...)`);
                        } else {
                            add('variable', node.id.name, node.loc.start.line, node.loc.start.column, `${init.callee.name}(...)`);
                        }
                    }
                }
            },
            ClassDeclaration(node) {
                if (node.id) add('class', node.id.name, node.loc.start.line, node.loc.start.column, null);
            },
            ImportDeclaration(node) {
                for (const spec of node.specifiers) {
                    const localName = spec.local?.name || '?';
                    const importedName = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name || localName;
                    add('import', `${localName} (from "${node.source.value}")`, node.loc.start.line, node.loc.start.column, `import ${importedName} from "${node.source.value}"`);
                }
            },
        });

        return declarations;
    };

    const memberExprToString = (node) => {
        if (node.type === 'Identifier') return node.name;
        if (node.type === 'MemberExpression') {
            return `${memberExprToString(node.object)}.${memberExprToString(node.property)}`;
        }
        return '?';
    };

    const extractInitializer = (declarator) => {
        if (!declarator.init) return null;
        if (declarator.init.type === 'Literal') return `= ${declarator.init.raw}`;
        if (declarator.init.type === 'Identifier') return `= ${declarator.init.name}`;
        if (declarator.init.type === 'CallExpression') {
            const callee = memberExprToString(declarator.init.callee);
            return `${callee}(...)`;
        }
        return null;
    };

    const formatFnDetail = (fn) => {
        const params = fn.params.map((p) => p.type === 'Identifier' ? p.name : '...').join(', ');
        return `function ${fn.id?.name || ''}(${params})`;
    };

    const buildIndex = async () => {
        const root = getWorkspaceRoot();
        if (!root) { declIndex = []; return; }

        const allPaths = await workspaceIndex.getAllPaths();
        const results = [];

        for (const relPath of allPaths) {
            const absPath = path.resolve(root, relPath);
            const ext = path.extname(relPath).toLowerCase();
            if (!TEXT_EXTENSIONS.has(ext)) continue;

            const parsed = parseFile(absPath);
            const decls = extractDeclarations(parsed);
            for (const d of decls) {
                d.relativePath = relPath;
                results.push(d);
            }
        }

        declIndex = results;
    };

    const ensureIndex = async () => {
        if (!declIndex) await buildIndex();
    };

    const markDirty = () => {
        declIndex = null;
    };

    const refresh = async () => {
        declIndex = null;
        await buildIndex();
    };

    const search = async (query) => {
        await ensureIndex();
        const lower = query.toLowerCase();

        return (declIndex || []).filter((d) =>
            d.name.toLowerCase().includes(lower) ||
            d.type.toLowerCase().includes(lower) ||
            (d.detail && d.detail.toLowerCase().includes(lower)) ||
            d.relativePath.toLowerCase().includes(lower),
        ).slice(0, 100);
    };

    const findByType = async (type) => {
        await ensureIndex();
        return (declIndex || []).filter((d) => d.type === type).slice(0, 200);
    };

    const findByName = async (name) => {
        await ensureIndex();
        const lower = name.toLowerCase();
        return (declIndex || []).filter((d) => d.name.toLowerCase() === lower).slice(0, 50);
    };

    const findByFile = async (filePath) => {
        await ensureIndex();
        const lower = filePath.toLowerCase().replace(/\\/g, '/');
        return (declIndex || []).filter((d) => d.relativePath.toLowerCase() === lower).slice(0, 200);
    };

    const getIndexStats = async () => {
        await ensureIndex();
        const counts = {};
        for (const d of declIndex || []) {
            counts[d.type] = (counts[d.type] || 0) + 1;
        }
        return {
            total: (declIndex || []).length,
            byType: counts,
            files: new Set((declIndex || []).map((d) => d.relativePath)).size,
        };
    };

    const getContextSummary = async () => {
        await ensureIndex();
        if (!declIndex || declIndex.length === 0) return '';

        // Group by file
        const byFile = {};
        for (const d of declIndex) {
            if (!byFile[d.relativePath]) byFile[d.relativePath] = [];
            byFile[d.relativePath].push(d);
        }

        const lines = ['=== Code Index Summary ==='];
        for (const [file, decls] of Object.entries(byFile).sort()) {
            const funcs = decls.filter((d) => d.type === 'function' || d.type === 'export-function' || d.type === 'export-default');
            const classes = decls.filter((d) => d.type === 'class' || d.type === 'export-class');
            const hooks = decls.filter((d) => d.type === 'hook');
            const imports = decls.filter((d) => d.type === 'import');
            const exports = decls.filter((d) => d.type.startsWith('export'));

            const parts = [];
            if (funcs.length) parts.push(`${funcs.length} functions`);
            if (classes.length) parts.push(`${classes.length} classes`);
            if (hooks.length) parts.push(`${hooks.length} hooks`);
            if (imports.length) parts.push(`${imports.length} imports`);
            if (exports.length) parts.push(`${exports.length} exports`);

            if (parts.length > 0) {
                lines.push(`  ${file} (${parts.join(', ')})`);
            }
        }
        lines.push(`\nTotal indexed: ${declIndex.length} declarations across ${byFile.size} files`);
        return lines.join('\n');
    };

    return {
        buildIndex,
        refresh,
        markDirty,
        search,
        findByType,
        findByName,
        findByFile,
        getIndexStats,
        getContextSummary,
    };
};
