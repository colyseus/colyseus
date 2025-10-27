//
// Polyfills for legacy environments
//

/*
 * Support Android 4.4.x
 */
if (!ArrayBuffer.isView) {
    ArrayBuffer.isView = (a: any): a is ArrayBufferView => {
        return a !== null && typeof (a) === 'object' && a.buffer instanceof ArrayBuffer;
    };
}

// Define globalThis if not available.
// https://github.com/colyseus/colyseus.js/issues/86
if (
    typeof (globalThis) === "undefined" &&
    typeof (window) !== "undefined"
) {
    // @ts-ignore
    window['globalThis'] = window;
}

// Cocos Creator does not provide "FormData"
// Define a dummy implementation so it doesn't crash
if (typeof(FormData) === "undefined") {
    // @ts-ignore
    globalThis['FormData'] = class {};
}