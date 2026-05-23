import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILES = ['package.json', 'forge.config.js', 'forge.config.cjs', 'vite.config.js', 'vite.config.mjs', 'webpack.config.js', 'tsconfig.json', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.prettierrc', '.prettierrc.json', '.prettierrc.js', 'jest.config.js', 'vitest.config.js', '.gitignore'];

export const createProjectMetadataService = ({ getWorkspaceRoot }) => {
    let cached = null;

    const readJson = (filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
        } catch { /* */ }
        return null;
    };

    const readConfig = (filePath) => {
        try {
            if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
        } catch { /* */ }
        return null;
    };

    const detectFramework = (pkg) => {
        const all = { ...pkg?.dependencies, ...pkg?.devDependencies };
        if (all?.react) return { name: 'React', version: all.react, isElectronRenderer: true };
        if (all?.vue) return { name: 'Vue', version: all.vue };
        if (all?.svelte) return { name: 'Svelte', version: all.svelte };
        return { name: 'Vanilla JS', version: null, isElectronRenderer: true };
    };

    const detectBundler = (pkg, root) => {
        const all = { ...pkg?.dependencies, ...pkg?.devDependencies };
        if (all?.['@electron-forge/plugin-vite'] || existsFile(root, 'vite.config.js')) return 'Vite';
        if (all?.webpack || all?.['@electron-forge/plugin-webpack']) return 'Webpack';
        return 'Unknown';
    };

    const detectTestRunner = (pkg) => {
        const all = { ...pkg?.dependencies, ...pkg?.devDependencies };
        if (all?.vitest) return 'Vitest';
        if (all?.jest) return 'Jest';
        if (all?.mocha) return 'Mocha';
        if (all?.ava) return 'AVA';
        return null;
    };

    const detectLinter = (root) => {
        for (const name of ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml']) {
            if (existsFile(root, name)) return 'ESLint';
        }
        return null;
    };

    const existsFile = (root, name) => fs.existsSync(path.join(root, name));

    const build = () => {
        const root = getWorkspaceRoot();
        if (!root) { cached = null; return null; }

        const pkg = readJson(path.join(root, 'package.json'));
        if (!pkg) { cached = null; return null; }

        const framework = detectFramework(pkg);
        const bundler = detectBundler(pkg, root);
        const testRunner = detectTestRunner(pkg);
        const linter = detectLinter(root);
        const hasTypeScript = existsFile(root, 'tsconfig.json') || existsFile(root, 'tsconfig.base.json');
        const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };

        // Read config files for raw content
        const configs = {};
        for (const name of CONFIG_FILES) {
            const content = readConfig(path.join(root, name));
            if (content) configs[name] = content;
        }

        // Detect Electron process boundaries from forge config
        let electronEntryMain = null;
        let electronEntryPreload = null;
        let electronEntryRenderer = null;
        const forgeConfig = configs['forge.config.js'] || configs['forge.config.cjs'];
        if (forgeConfig) {
            const entryMatch = forgeConfig.match(/entryPoint\s*:\s*['"]([^'"]+)['"]/);
            if (entryMatch) electronEntryMain = entryMatch[1];
            const preloadMatch = forgeConfig.match(/preload\s*:\s*['"]([^'"]+)['"]/);
            if (preloadMatch) electronEntryPreload = preloadMatch[1];
        }
        // Vite config may have input entry
        const viteConfig = configs['vite.config.js'] || configs['vite.config.mjs'];
        if (viteConfig) {
            const inputMatch = viteConfig.match(/input\s*:\s*['"]([^'"]+)['"]/);
            if (inputMatch) {
                if (!electronEntryRenderer) electronEntryRenderer = inputMatch[1];
            }
        }

        // Detect electron from dependencies
        const electronVersion = allDeps?.electron || null;

        cached = {
            name: pkg.name || '(unnamed)',
            version: pkg.version || '0.0.0',
            description: pkg.description || '',
            scripts: pkg.scripts || {},
            framework,
            bundler,
            testRunner,
            linter,
            hasTypeScript,
            electronVersion,
            electronBoundaries: {
                main: electronEntryMain || 'src/main.js',
                preload: electronEntryPreload || 'src/preload.js',
                renderer: electronEntryRenderer || 'src/index.html (entry point)',
            },
            dependencies: Object.entries(pkg.dependencies || {}).map(([n, v]) => `${n}@${v}`),
            devDependencies: Object.entries(pkg.devDependencies || {}).map(([n, v]) => `${n}@${v}`),
            buildScripts: {
                start: pkg.scripts?.start || null,
                build: pkg.scripts?.build || null,
                test: pkg.scripts?.test || null,
                lint: pkg.scripts?.lint || null,
                typecheck: pkg.scripts?.typecheck || null,
            },
            configFiles: Object.keys(configs),
            // Raw config content for AI reference
            rawConfigs: configs,
        };
        return cached;
    };

    const getMetadata = () => {
        if (!cached) build();
        return cached;
    };

    const refresh = () => {
        cached = null;
        return build();
    };

    const getContextSummary = () => {
        const m = getMetadata();
        if (!m) return '';

        const lines = ['=== Project Metadata ==='];
        lines.push(`Project: ${m.name} v${m.version}`);
        lines.push(`Description: ${m.description || '(none)'}`);
        lines.push(`Framework: ${m.framework.name}${m.framework.version ? ` v${m.framework.version}` : ''}`);
        lines.push(`Bundler: ${m.bundler}`);
        lines.push(`Electron: ${m.electronVersion ? `v${m.electronVersion}` : 'not detected'}`);

        if (m.testRunner) lines.push(`Test runner: ${m.testRunner}`);
        if (m.linter) lines.push(`Linter: ${m.linter}`);
        if (m.hasTypeScript) lines.push('TypeScript: yes');
        if (m.scripts?.start) lines.push(`Start: ${m.scripts.start}`);
        if (m.scripts?.build) lines.push(`Build: ${m.scripts.build}`);
        if (m.scripts?.test) lines.push(`Test: ${m.scripts.test}`);
        if (m.scripts?.lint) lines.push(`Lint: ${m.scripts.lint}`);

        lines.push('\nElectron Process Boundaries:');
        lines.push(`  Main:     ${m.electronBoundaries.main}`);
        lines.push(`  Preload:  ${m.electronBoundaries.preload}`);
        lines.push(`  Renderer: ${m.electronBoundaries.renderer}`);
        lines.push('  ⚠ Main process: Node.js API + Electron IPC. No DOM, no React.');
        lines.push('  ⚠ Preload: `contextBridge` + `ipcRenderer` only. Minimal logic.');
        lines.push('  ⚠ Renderer: Browser environment with React. Use IPC to reach main process.');

        if (m.dependencies.length > 0) {
            lines.push(`\nDependencies (${m.dependencies.length}):`);
            for (const dep of m.dependencies.slice(0, 30)) lines.push(`  ${dep}`);
        }
        if (m.devDependencies.length > 0) {
            lines.push(`\nDev Dependencies (${m.devDependencies.length}):`);
            for (const dep of m.devDependencies.slice(0, 30)) lines.push(`  ${dep}`);
        }
        if (m.configFiles.length > 0) {
            lines.push(`\nConfig files: ${m.configFiles.join(', ')}`);
        }

        // Include forge.config content if it exists
        if (m.rawConfigs?.['forge.config.js'] || m.rawConfigs?.['forge.config.cjs']) {
            const fc = m.rawConfigs['forge.config.js'] || m.rawConfigs['forge.config.cjs'];
            const snippet = fc.length > 800 ? fc.slice(0, 800) + '\n  ... (truncated)' : fc;
            lines.push('\nForge config:');
            lines.push(snippet);
        }

        return lines.join('\n');
    };

    return { getMetadata, refresh, getContextSummary, build };
};
