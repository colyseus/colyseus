// Mock window.localStorage for Node.js test environment
const localStorageMock: Storage = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (index: number) => Object.keys(store)[index] ?? null,
    };
})();

// @ts-ignore
globalThis.window = globalThis.window || {};
// @ts-ignore
globalThis.window.localStorage = localStorageMock;
