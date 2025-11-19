import { Room, Client, ClientState, ClientPrivate, AuthContext } from '@colyseus/core';

export function applyMonkeyPatch() {
  const _onJoin = Room.prototype['_onJoin'];
  Room.prototype['_onJoin'] = async function (this: Room, client: Client & ClientPrivate) {
    const result = await _onJoin.apply(this, arguments as any);

    if (client.state === ClientState.JOINING) {
      const messageTypes = Object.keys(this['onMessageEvents'].events).filter((type) => type.indexOf("__") !== 0)
      client.send("__playground_message_types", messageTypes);
    }

    return result;
  }
}