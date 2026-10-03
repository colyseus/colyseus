type FunctionParameters<T extends (...args: any[]) => any> =
  T extends (...args: infer P) => any
    ? P
    : never;

// once() wrapper → cb; a property on the wrapper would change its map and slow invoke()
const onceTargets = new WeakMap<Function, Function>();

export class EventEmitter<CallbackSignature extends (...args: any[]) => any> {
  handlers: Array<CallbackSignature> = [];

  register(cb: CallbackSignature, once: boolean = false) {
    this.handlers.push(cb);
    return this;
  }

  invoke(...args: FunctionParameters<CallbackSignature>) {
    // not forEach: its per-call closure costs 2–8x; handlers added mid-invoke run from the next invoke
    const handlers = this.handlers;
    for (let i = 0, l = handlers.length; i < l; i++) { handlers[i].apply(this, args); }
  }

  invokeAsync(...args: FunctionParameters<CallbackSignature>) {
    return Promise.all(this.handlers.map((handler) => handler.apply(this, args)));
  }

  remove (cb: CallbackSignature) {
    let index = this.handlers.indexOf(cb);
    if (index === -1) { index = this.handlers.findIndex((h) => onceTargets.get(h) === cb); }
    if (index !== -1) {
      // copy-on-write: an in-flight invoke() keeps iterating the old array
      this.handlers = this.handlers.filter((_, i) => i !== index);
    }
  }

  clear() {
    this.handlers = [];
  }
}

export function createSignal<CallbackSignature extends (...args: any[]) => void | Promise<any>>()
  :
   {
    once: (cb: CallbackSignature) => void;
    remove: (cb: CallbackSignature) => void,
    invoke: (...args: FunctionParameters<CallbackSignature>) => void,
    invokeAsync: (...args: FunctionParameters<CallbackSignature>) => Promise<any[]>,
    clear: () => void,
  } & ((this: any, cb: CallbackSignature) => EventEmitter<CallbackSignature> )
  {
  const emitter = new EventEmitter<CallbackSignature>();

  function register(this: any, cb: CallbackSignature): EventEmitter<CallbackSignature> {
    return emitter.register(cb, this === null);
  };

  register.once = (cb: CallbackSignature) => {
    const callback: any = function (this: any, ...args: any[]) {
      emitter.remove(callback); // first, so a throw or re-entrant invoke can't fire it twice
      cb.apply(this, args);
    }
    onceTargets.set(callback, cb);
    emitter.register(callback);
  }
  register.remove = (cb: CallbackSignature) => emitter.remove(cb)
  register.invoke = (...args: FunctionParameters<CallbackSignature>) => emitter.invoke(...args);
  register.invokeAsync = (...args: FunctionParameters<CallbackSignature>) => emitter.invokeAsync(...args);
  register.clear = () => emitter.clear();

  return register;
}