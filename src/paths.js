export const BASE = import.meta.env?.BASE_URL || '/';
export const assetURL = path => /^https?:\/\//.test(path) ? path : new URL(BASE + path.replace(/^\//, ''), globalThis.location?.origin || 'http://localhost').href;
