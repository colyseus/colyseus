import { Room, type RoomOptions, type ExtractRoomState } from "@colyseus/core";

type RoomLifecycleMethods =
  | 'messages'
  | 'onCreate'
  | 'onJoin'
  | 'onLeave'
  | 'onDispose'
  | 'onCacheRoom'
  | 'onRestoreRoom'
  | 'onDrop'
  | 'onReconnect'
  | 'onUncaughtException'
  | 'onAuth'
  | 'onBeforeShutdown'
  | 'onBeforePatch';

type DefineRoomOptions<T extends RoomOptions = RoomOptions> =
  Partial<Pick<Room<T>, RoomLifecycleMethods>> &
  { state?: ExtractRoomState<T> | (() => ExtractRoomState<T>); } &
  ThisType<Room<T>>;

export function createRoom<T extends RoomOptions = RoomOptions>(options: DefineRoomOptions<T>) {
  class _ extends Room<T> {
    messages = options.messages;

    constructor() {
      super();
      if (options.state && typeof options.state === 'function') {
        this.state = options.state();
      }
    }
  }

  // Copy all methods to the prototype
  for (const key in options) {
    if (typeof options[key] === 'function') {
      _.prototype[key] = options[key];
    }
  }

  return _ as typeof Room<T>;
}
