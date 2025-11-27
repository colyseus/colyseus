import { Room, Client, ClientState, ClientPrivate, AuthContext } from '@colyseus/core';

export async function applyMonkeyPatch() {
  /**
   * Optional: if zod is available, we can use toJSONSchema() for body and query types
   */
  let z: any = undefined;
  try { z = await import("zod"); } catch (e: any) { /* zod not installed  */ }

  const _onJoin = Room.prototype['_onJoin'];
  Room.prototype['_onJoin'] = async function (this: Room, client: Client & ClientPrivate) {
    const result = await _onJoin.apply(this, arguments as any);

    if (client.state === ClientState.JOINING) {

      const messages: any = {};
      Object.keys(this['onMessageEvents'].events).sort().forEach((type) => {
        if (type.indexOf("__") === 0 || type === "*") { return; }

        const messageValidator = this['onMessageValidators'][type];
        messages[type] = z && messageValidator && z.toJSONSchema(messageValidator) || null;
      });

      client.send("__playground_message_types", messages);
    }

    return result;
  }
}