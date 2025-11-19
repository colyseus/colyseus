/**
 * Monkey-patch Colyseus SDK to intercept and expose some private events
 */
import { Room, Protocol } from "colyseus.js";

export const RAW_EVENTS_KEY = '$_raw';
export const DEVMODE_RESTART = '$_devmode';

let roomConnectedCallback = (room: Room) =>
  console.warn("roomConnectedCallback not set. use onRoomConnected() to set it up.");

export function onRoomConnected(callback: (room: Room) => void) {
  roomConnectedCallback = callback;
}

const connect = Room.prototype['connect'];
Room.prototype['connect'] = function(endpoint: string, devModeCloseCallback: () => void, room: Room) {
  // @ts-ignore
  connect.apply(this, arguments);

  (room as any)[RAW_EVENTS_KEY] = [];

  // intercept send events
  const send = room.connection['send'];
  room.connection['send'] = (data: Uint8Array | Buffer) => {
    const sendBytes = Array.from(new Uint8Array(data));

    room['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['out', getEventType(sendBytes[0]), sendBytes]);
    send.call(room.connection, data);
  };

  const events = room.connection.events;

  const onerror = events.onerror;
  events.onerror = (error: any) => {
    room['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['error', 'ERROR', error.message]);
    onerror?.(error);
  };

  // intercept close events
  const onclose = events.onclose;
  events.onclose = (event: any) => {
    delete (room as any)[RAW_EVENTS_KEY];
    if (event.code === 4010) {// CloseCode.DEVMODE_RESTART
      room['onMessageHandlers'].emit(DEVMODE_RESTART);
      room['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['close', 'CLOSE_DEVMODE_RESTART', { code: event.code }]);
    } else {
      room['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['close', 'CLOSE', { code: event.code }]);
    }
    onclose?.(event);
  };

  // expose room to playground app
  roomConnectedCallback(room);
}

const onMessageCallback = Room.prototype['onMessageCallback'];
Room.prototype['onMessageCallback'] = function(event: MessageEvent) {
  const bytes = Array.from(new Uint8Array(event.data))

  // create local cache while the room is joining.
  // so we can consume them immediately when the join callback is called.
  if (!this['onMessageHandlers'].events[RAW_EVENTS_KEY]) {
    (this as any)[RAW_EVENTS_KEY].unshift(['in', getEventType(bytes[0]), bytes, new Date()]);
  }

  this['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['in', getEventType(bytes[0]), bytes ]);
  onMessageCallback.call(this, event);
}

function getEventType(code: number) {
  // TODO: fix nomenclature on SDK itself
  let eventType = Protocol[code]?.replace("ROOM_", "");
  if (eventType === "DATA") {
    eventType = "MESSAGE";
  }
  return eventType;
}
