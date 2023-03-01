import * as path from 'node:path';

import hash from '@emotion/hash';
import * as esbuild from 'esbuild';
import MagicString from 'magic-string';

import { compileVanillaFile } from './integration/compile.js';
import { evaluateVanillaFile } from './integration/evaluate.js';
import { processVanillaFile } from './integration/process.js';
import { getRandomId, RE_CSS_FILTER } from './integration/utils.js';

const RE_OPT_START = /\b([a-zA-Z0-9_$]+)\(.+?\/\*__VE_RUNTIME_START__\*\//g;
const OPT_START = `/*__VE_RUNTIME_START__*/`;
const OPT_END = `/*__VE_RUNTIME_END__*/`;

/**
 * @returns {import('vite').Plugin}
 */
function vanillaExtractPlugin (options = {}) {
	let { outputCss = true, identifiers, esbuildOptions } = options;

	let prod = false;
	let cwd = '';

	const runtimeId = '\0ve-runtime';

	return {
		name: '@intrnl/vite-plugin-vanilla-extract-runtime',
		configResolved (config) {
			prod = config.isProduction;

			identifiers ||= prod ? 'short' : 'debug';
			cwd = config.root;
		},
		resolveId (id) {
			if (id === runtimeId) {
				return id;
			}

			return null;
		},
		async load (id) {
			const [properId] = id.split('?');

			if (properId === runtimeId) {
				return `
export function inject (id, content) {
	let elementId = 've' + id;
	let style = document.getElementById(elementId);

	if (!style) {
		style = document.createElement('style');
		style.id = elementId;

		document.head.appendChild(style);
	}

	style.textContent = content;
}
`;
			}

			if (!RE_CSS_FILTER.test(properId) || properId[0] === '\0') {
				return null;
			}

			const dirname = path.dirname(properId);
			const filenameKey = hash.default(path.relative(cwd, properId));

			const { source, dependencies } = await compileVanillaFile({
				filename: properId,
				cwd,
				outputCss,
				esbuildOptions,
				identOption: identifiers,
			});

			const data = evaluateVanillaFile({ filename: properId, source });

			let { js, css } = processVanillaFile({
				filename: properId,
				cwd,
				data,
				serializeImport: (pathname, isEntry) => {
					if (isEntry) {
						return ``;
					}
					else {
						return `import ${JSON.stringify(relative(dirname, pathname))};`;
					}
				},
			});

			if (outputCss) {
				if (prod) {
					const result = await esbuild.transform(css, {
						loader: 'css',
						minify: true,
					});

					css = result.code.trimEnd();

					if (css) {
						css = OPT_START + css + OPT_END;
					}
				}
				else {
					css += `\n/*# sourceURL=${properId}?css */`;
				}

				if (css) {
					const key = getRandomId();

					js = `
import * as ${key} from '${runtimeId}';
${js};
${key}.inject(${JSON.stringify(filenameKey)}, ${JSON.stringify(css)});
`;
				}
			}

			for (const file of dependencies) {
				this.addWatchFile(file);
			}

			return { code: js, moduleSideEffects: true };
		},
		renderChunk (code, chunk, opts) {
			if (!code.includes(OPT_START)) {
				return null;
			}

			// the reason why we added all that banner and footer is so that we can
			// concatenate them all here, to reduce the amount of times a style is
			// being appended to the DOM.

			// depending on the user's code, it could potentially be problematic if
			// there's anything like top-level await, the safer option seems to append
			// everything to the last call usage instead of moving everything to the
			// very end of the script.

			const str = new MagicString(code);
			const matches = Array.from(code.matchAll(RE_OPT_START));

			let map = null;

			if (matches.length === 1) {
				// fast path for single matches, just removes the key
				let match = matches[0];

				let cssStart = match.index + match[0].length;
				let cssEnd = code.indexOf(OPT_END, cssStart);

				str.update(cssStart - OPT_START.length, cssStart, '');
				str.update(cssEnd, cssEnd + OPT_END.length, '');
			}
			else {
				// it would be nice if we can skip the transformation on the last match,
				// since really all we need to do there is append the concatenated
				// styles from all before it.

				// just going to play it safe right now.

				const key = hash.default(chunk.name);
				let concat = '';

				for (let idx = 0, len = matches.length; idx < len; idx++) {
					let match = matches[idx];

					let cssStart = match.index + match[0].length;
					let cssEnd = code.indexOf(OPT_END, cssStart);

					let stmtStart = match.index;
					let stmtEnd = cssEnd + OPT_END.length + 1;

					let quote = code[cssStart - OPT_START.length - 1];

					let css = code.slice(cssStart, cssEnd);

					if (code[stmtEnd + 1] === ';') {
						stmtEnd++;
					}

					// we can't use the value as is if there's any attempts on escaping.
					if (css.includes('\\')) {
						if (quote === '"') {
							css = JSON.parse(quote + css + quote);
						}
						else {
							const ast = this.parse(quote + css + quote);
							const node = ast.body[0].expression;

							css = node.value;
						}
					}

					concat += css;
					str.remove(stmtStart, stmtEnd);

					if (idx === len - 1) {
						str.prependLeft(stmtStart, `${match[1]}(${JSON.stringify(key)}, ${JSON.stringify(concat)});`);
					}
				}
			}

			if (opts.sourcemap) {
				map = str.generateMap();
			}

			return { code: str.toString(), map };
		},
	};
}

export default vanillaExtractPlugin;

function relative (from, to) {
	let pathname = path.relative(from, to);

	if (pathname.slice(0, 3) !== '../') {
		pathname = './' + pathname;
	}

	return pathname;
}
