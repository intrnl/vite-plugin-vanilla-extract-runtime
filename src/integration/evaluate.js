import evalCode from 'eval';

export function evaluateVanillaFile (options) {
	const { filename, source } = options;

	const globals = { console, process };
	const result = evalCode(source, filename, globals, true);

	return result;
}
