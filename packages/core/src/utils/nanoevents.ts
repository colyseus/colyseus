export const createNanoEvents = () => ({
    emit(event: string, ...args: any[]) {
      for (
        let callbacks = this.events[event] || [],
          i = 0,
          length = callbacks.length;
        i < length;
        i++
      ) {
        callbacks[i](...args)
      }
    },
    // null-prototype: event names are client-supplied (message types), and on a
    // plain object "__proto__" / "constructor" / "toString" resolve to inherited
    // members instead of missing (colyseus/colyseus#951)
    events: Object.create(null) as { [event: string]: Array<(...args: any[]) => void> },
    on(event: string, cb: (...args: any[]) => void) {
      ;(this.events[event] ||= []).push(cb)
      return () => {
        this.events[event] = this.events[event]?.filter(i => cb !== i)
      }
    }
  })