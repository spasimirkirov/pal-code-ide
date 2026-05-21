import { defineConfig } from 'vite';
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator';

// https://vitejs.dev/config
const createObfuscationPlugin = (mode) =>
	mode === 'production'
		? obfuscatorPlugin({
			apply: 'build',
			include: [/[\\/]src[\\/].*\.(js|mjs|cjs)$/],
			exclude: [/node_modules/],
			options: {
				compact: true,
				controlFlowFlattening: true,
				controlFlowFlatteningThreshold: 0.82,
				deadCodeInjection: true,
				deadCodeInjectionThreshold: 0.12,
				debugProtection: false,
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
				stringArrayThreshold: 0.95,
				transformObjectKeys: true,
			},
		})
		: null;

export default defineConfig(({ mode }) => ({
	plugins: [createObfuscationPlugin(mode)].filter(Boolean),
}));
