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
    events: {},
    on(event: string, cb: (...args: any[]) => void) {
      ;(this.events[event] ||= []).push(cb)
      return () => {
        this.events[event] = this.events[event]?.filter(i => cb !== i)
      }
    }
  })