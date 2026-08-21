import { Room, Client, ClientState, ClientPrivate, AuthContext } from '@colyseus/core';
import { toJSONSchema } from './json-schema.js';

export async function applyMonkeyPatch() {
  const _onJoin = Room.prototype['_onJoin'];
  Room.prototype['_onJoin'] = async function (this: Room, client: Client & ClientPrivate) {
    const result = await _onJoin.apply(this, arguments as any);

    if (client.state === ClientState.JOINING) {

      const messages: any = {};
      for (const type of Object.keys(this['onMessageEvents'].events).sort()) {
        if (type.indexOf("__") === 0 || type === "*") { continue; }
        messages[type] = await toJSONSchema(this['onMessageValidators'][type]);
      }

      client.send("__playground_message_types", messages);
    }

    return result;
  }
}