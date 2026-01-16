/**
 * Monkey-patch Colyseus SDK to intercept and expose some private events
 */
import { Room, Protocol, CloseCode } from "@colyseus/sdk";

export const RAW_EVENTS_KEY = '$_raw';
export const DEVMODE_RESTART = '$_devmode';

let roomConnectedCallback = (room: Room) =>
  console.warn("roomConnectedCallback not set. use onRoomConnected() to set it up.");

export function onRoomConnected(callback: (room: Room) => void) {
  roomConnectedCallback = callback;
}

const connect = Room.prototype['connect'];
Room.prototype['connect'] = function(endpoint: string, devModeCloseCallback: () => void) {
  // @ts-ignore
  connect.apply(this, arguments);

  const room = this;
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
    if (event.code === CloseCode.MAY_TRY_RECONNECT) {
      room['onMessageHandlers'].emit(DEVMODE_RESTART);
      room['onMessageHandlers'].emit(RAW_EVENTS_KEY, ['close', 'MAY_TRY_RECONNECT', { code: event.code }]);
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

// Dynamically generate protocol codes mapping from Protocol
const protocolCodes = Object.entries(Protocol).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {} as Record<number, string>);

function getEventType(code: number) {
  return protocolCodes[code];
}
