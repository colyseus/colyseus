/**
 * The MIT License (MIT)
 *
 * Copyright 2016 Andrey Sitnik <andrey@sitnik.ru>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export type EventsMap = Record<string, (...args: any[]) => void>;

export interface Emitter<Events extends EventsMap> {
    events: { [K in keyof Events]?: Array<Events[K]> };
    emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void;
    on<K extends keyof Events>(event: K, cb: Events[K]): () => void;
}

export const createNanoEvents = <Events extends EventsMap = EventsMap>(): Emitter<Events> => ({
    emit(event, ...args) {
        let callbacks = this.events[event] || []
        for (let i = 0, length = callbacks.length; i < length; i++) {
            callbacks[i](...args)
        }
    },
    events: {},
    on(event, cb) {
        this.events[event]?.push(cb) || (this.events[event] = [cb])
        return () => {
            this.events[event] = this.events[event]?.filter(i => cb !== i)
        }
    }
});