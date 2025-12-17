export function now(): number {
    return typeof(performance) !== 'undefined' ? performance.now() : Date.now();
}