import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const createValidationService = ({ getWorkspaceRoot, getMainWindow }) => {
    let validationQueue = [];
    let running = false;

    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    };

    const exec = (command, args, cwd, timeoutMs = 60000) => {
        return new Promise((resolve) => {
            const fullCmd = `${command} ${args.join(' ')}`;
            const child = spawn(fullCmd, [], {
                cwd,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, timeoutMs);

            child.stdout.on('data', (data) => { stdout += String(data); });
            child.stderr.on('data', (data) => { stderr += String(data); });
            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({ code: code ?? -1, stdout, stderr, timedOut });
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({ code: -1, stdout, stderr: String(err?.message || 'Process error'), timedOut: false });
            });
        });
    };

    const detectTool = (root, name, fallbackCmd) => {
        // Check local node_modules first
        const localPath = path.join(root, 'node_modules', '.bin', name + (process.platform === 'win32' ? '.cmd' : ''));
        if (fs.existsSync(localPath)) return localPath;
        // Check global / PATH
        try {
            require.resolve(name, { paths: [root] });
            return name;
        } catch { /* */ }
        return fallbackCmd || null;
    };

    const runLint = async () => {
        const root = getWorkspaceRoot();
        if (!root) return { ok: false, error: 'No workspace root.' };

        // Detect linter
        const hasEslint = fs.existsSync(path.join(root, '.eslintrc')) ||
                          fs.existsSync(path.join(root, '.eslintrc.json')) ||
                          fs.existsSync(path.join(root, '.eslintrc.js')) ||
                          fs.existsSync(path.join(root, '.eslintrc.cjs'));

        const pkg = getPackageJson(root);
        const lintScript = pkg?.scripts?.lint;

        if (lintScript) {
            const result = await exec('npx', ['--yes', 'run', 'lint'], root, 60000);
            return {
                ok: result.code === 0,
                command: `npm run lint`,
                exitCode: result.code,
                output: truncateOutput(result.stdout + result.stderr),
                timedOut: result.timedOut,
            };
        }

        if (hasEslint) {
            const eslintBin = detectTool(root, 'eslint', 'npx eslint');
            const result = await exec(eslintBin, ['.', '--format', 'compact'], root, 60000);
            return {
                ok: result.code === 0,
                command: `${eslintBin} .`,
                exitCode: result.code,
                output: truncateOutput(result.stdout + result.stderr),
                timedOut: result.timedOut,
            };
        }

        return { ok: true, skipped: true, reason: 'No linter detected.' };
    };

    const runTypeCheck = async () => {
        const root = getWorkspaceRoot();
        if (!root) return { ok: false, error: 'No workspace root.' };

        const hasTsconfig = fs.existsSync(path.join(root, 'tsconfig.json'));
        const pkg = getPackageJson(root);
        const typecheckScript = pkg?.scripts?.typecheck;

        if (typecheckScript) {
            const result = await exec('npx', ['--yes', 'run', 'typecheck'], root, 60000);
            return {
                ok: result.code === 0,
                command: `npm run typecheck`,
                exitCode: result.code,
                output: truncateOutput(result.stdout + result.stderr),
                timedOut: result.timedOut,
            };
        }

        if (hasTsconfig) {
            const tscBin = detectTool(root, 'tsc', 'npx tsc');
            const result = await exec(tscBin, ['--noEmit'], root, 60000);
            return {
                ok: result.code === 0,
                command: `${tscBin} --noEmit`,
                exitCode: result.code,
                output: truncateOutput(result.stdout + result.stderr),
                timedOut: result.timedOut,
            };
        }

        return { ok: true, skipped: true, reason: 'No TypeScript config detected.' };
    };

    const runBuild = async () => {
        const root = getWorkspaceRoot();
        if (!root) return { ok: false, error: 'No workspace root.' };

        const pkg = getPackageJson(root);
        const buildScript = pkg?.scripts?.build;

        if (!buildScript) {
            return { ok: true, skipped: true, reason: 'No build script defined in package.json.' };
        }

        const result = await exec('npm', ['run', 'build'], root, 120000);
        return {
            ok: result.code === 0,
            command: `npm run build`,
            exitCode: result.code,
            output: truncateOutput(result.stdout + result.stderr),
            timedOut: result.timedOut,
        };
    };

    const runTests = async ({ testFile } = {}) => {
        const root = getWorkspaceRoot();
        if (!root) return { ok: false, error: 'No workspace root.' };

        const pkg = getPackageJson(root);
        const testScript = pkg?.scripts?.test;

        if (!testScript) {
            return { ok: true, skipped: true, reason: 'No test script defined in package.json.' };
        }

        const args = ['run', 'test'];
        if (testFile) args.push('--', testFile);

        const result = await exec('npm', args, root, 120000);
        return {
            ok: result.code === 0,
            command: `npm ${args.join(' ')}`,
            exitCode: result.code,
            output: truncateOutput(result.stdout + result.stderr),
            timedOut: result.timedOut,
        };
    };

    const runAll = async () => {
        const [lint, typecheck, build] = await Promise.all([
            runLint(),
            runTypeCheck(),
            runBuild(),
        ]);
        return { lint, typecheck, build };
    };

    // Debounced validation: if multiple file changes happen rapidly,
    // only run once after the last change
    const scheduleValidation = () => {
        if (running) {
            validationQueue.push(Date.now());
            return;
        }

        const execute = async () => {
            running = true;
            validationQueue = [];
            emit('validation:start', {});

            // Wait a moment for more changes to settle
            await new Promise((r) => setTimeout(r, 1500));

            // Check if new changes came in
            if (validationQueue.length > 0) {
                validationQueue = [];
                await new Promise((r) => setTimeout(r, 1500));
            }

            const results = await runAll();
            emit('validation:result', results);

            running = false;

            // If more changes queued during execution, run again
            if (validationQueue.length > 0) {
                validationQueue = [];
                scheduleValidation();
            }
        };

        setTimeout(execute, 500);
    };

    const trigger = () => scheduleValidation();

    const getPackageJson = (root) => {
        try {
            return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
        } catch { return null; }
    };

    const truncateOutput = (text) => {
        const str = String(text || '');
        if (str.length > 8000) return str.slice(0, 8000) + `\n... (truncated, ${str.length - 8000} more chars)`;
        return str;
    };

    return { runLint, runTypeCheck, runBuild, runTests, runAll, trigger, scheduleValidation };
};
