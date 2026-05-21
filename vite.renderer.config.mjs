import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

// https://vitejs.dev/config
const createObfuscationPlugin = (mode) =>
    mode === 'production'
        ? obfuscatorPlugin({
            apply: 'build',
            include: [/[\\/]src[\\/].*\.(js|jsx|mjs|cjs)$/],
            exclude: [/node_modules/],
            options: {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.65,
                deadCodeInjection: true,
                deadCodeInjectionThreshold: 0.05,
                debugProtection: false,
                disableConsoleOutput: true,
                identifierNamesGenerator: 'hexadecimal',
                numbersToExpressions: true,
                renameGlobals: false,
                rotateStringArray: true,
                selfDefending: true,
                shuffleStringArray: true,
                simplify: true,
                splitStrings: true,
                splitStringsChunkLength: 6,
                stringArray: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.9,
                transformObjectKeys: true,
            },
        })
        : null;

export default defineConfig(({ mode }) => ({
    plugins: [react(), createObfuscationPlugin(mode)].filter(Boolean),
}));
