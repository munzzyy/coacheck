// One WebExtension namespace, both browsers. Firefox exposes the promise-based `browser`
// global; Chrome only has the callback-era `chrome` global, but its promise support is
// good enough now (121+) that every call site in this extension can just await it.
export const api = globalThis.browser ?? globalThis.chrome;
