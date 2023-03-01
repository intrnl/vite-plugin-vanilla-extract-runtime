export const RE_CSS_FILTER = /\.css\.(js|mjs|jsx|ts|mts|tsx)$/i;

export function getRandomId () {
	return '__' + Math.random().toString(36).slice(2, 8);
}
