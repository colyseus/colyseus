/// <reference path="../typings/cocos-creator.d.ts" />

/**
 * We do not assign 'storage' to window.localStorage immediatelly for React
 * Native compatibility. window.localStorage is not present when this module is
 * loaded.
 */

let storage: any;

function getStorage(): Storage {
    if (!storage)  {
        try {
            storage = (typeof (cc) !== 'undefined' && cc.sys && cc.sys.localStorage)
                ? cc.sys.localStorage  // compatibility with cocos creator
                : window.localStorage; // RN does have window object at this point, but localStorage is not defined

        } catch (e) {
            // ignore error
        }
    }

    if (!storage && typeof (globalThis.indexedDB) !== 'undefined') {
        storage = new IndexedDBStorage();
    }

    if (!storage) {
        // mock localStorage if not available (Node.js or RN environment)
        storage = {
            cache: {},
            setItem: function (key, value) { this.cache[key] = value; },
            getItem: function (key) { return this.cache[key]; },
            removeItem: function (key) { delete this.cache[key]; },
        };
    }

    return storage;
}

export function setItem(key: string, value: string) {
    bestEffort(() => getStorage().setItem(key, value));
}

export function removeItem(key: string) {
    bestEffort(() => getStorage().removeItem(key));
}

export function getItem(key: string, callback: Function) {
    const value: any = getStorage().getItem(key);

    if (
        typeof (Promise) === 'undefined' || // old browsers
        !(value instanceof Promise)
    ) {
        // browser has synchronous return
        callback(value);

    } else {
        // IndexedDB: a failed read restores nothing, keeping a value assigned meanwhile
        value.then((id) => callback(id), noop);
    }
}

/**
 * Persisting is best-effort: storage that's denied (e.g. a sandboxed document
 * without `allow-same-origin`) or full must not fail sign-in or sign-out,
 * whether the backend throws or rejects.
 */
function bestEffort(write: () => unknown) {
    try {
        const pending = write();
        if (pending instanceof Promise) { pending.catch(noop); }
    } catch (e) {}
}

function noop() {}

/**
 * When running in a Web Worker, we need to use IndexedDB to store data.
 */
class IndexedDBStorage {
    private dbPromise: Promise<IDBDatabase> = new Promise((resolve, reject) => {
        const request = indexedDB.open('_colyseus_storage', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('store');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    private async tx(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest) {
        const db = await this.dbPromise;
        const store = db.transaction('store', mode).objectStore('store');
        return fn(store);
    }

    setItem(key: string, value: string) {
        return this.tx('readwrite', store => store.put(value, key)).then();
    }

    async getItem(key: string) {
        const request = await this.tx('readonly', store => store.get(key));
        return new Promise<string | undefined>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    removeItem(key: string) {
        return this.tx('readwrite', store => store.delete(key)).then();
    }
}