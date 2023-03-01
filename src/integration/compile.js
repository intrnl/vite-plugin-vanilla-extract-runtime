import * as path from 'node:path';

import * as esbuild from 'esbuild';

import { transformPlugin } from './transform.js';
import { getRandomId } from './utils.js';

export async function compileVanillaFile (options) {
	const { filename, cwd = process.cwd(), esbuildOptions = {}, outputCss = true, identOption = 'debug' } = options;

	const key = getRandomId();

	const banner = `
(() => {
	const cssByFileScope = new Map();
	const localClassNames = new Set();
	const composedClassLists = [];
	const usedCompositions = new Set();

	const cssAdapter = {
		appendCss (css, fileScope) {${
		outputCss
			? `
			const filename = fileScope.filePath;
			const sources = cssByFileScope.get(filename) ?? [];

			sources.push(css);

			cssByFileScope.set(filename, sources);`
			: ''
	}
		},
		registerClassName (className) {
			localClassNames.add(className);
		},
		registerComposition (composedClassList) {
			composedClassLists.push(composedClassList);
		},
		markCompositionUsed (identifier) {
			usedCompositions.add(identifier);
		},
		onEndFileScope () {},
		getIdentOption () {
			return ${JSON.stringify(identOption)};
		},
	};

	globalThis.${key} = { cssByFileScope, localClassNames, composedClassLists, usedCompositions };
	require('@vanilla-extract/css/adapter').setAdapter(cssAdapter);
})();
`;

	const footer = `
(() => {
	require('@vanilla-extract/css/adapter').removeAdapter?.();
	module.exports = { ...globalThis.${key}, cssExports: module.exports };
})();
`;

	const result = await esbuild.build({
		bundle: true,
		write: false,
		metafile: true,
		format: 'cjs',
		platform: 'node',
		entryPoints: [filename],
		banner: { js: banner },
		footer: { js: footer },
		absWorkingDir: cwd,
		external: ['@vanilla-extract', ...(esbuildOptions.external || [])],
		plugins: [
			transformPlugin({ debug: identOption === 'debug' }),
			...(esbuildOptions.plugins || []),
		],
		loader: esbuildOptions.loader,
		define: esbuildOptions.define,
	});

	const { outputFiles, metafile } = result;

	return {
		source: outputFiles[0].text,
		dependencies: Object.keys(metafile.inputs).map((pathname) => path.join(cwd, pathname)).reverse(),
	};
}
