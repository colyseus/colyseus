import { Room } from "../src";

import { serialize } from "../src/serializer/Serializer";

import { Schema, type } from "@colyseus/schema";

class State extends Schema {
  @type("string")
  lastMessage: string = "";
}

export class ChatRoom extends Room<State> {
  maxClients = 4;

  onInit (options) {
    this.setState(new State());
  }

  async onAuth (options) {
    return { success: true };
  }

  onJoin (client, options, auth) {
    console.log("client has joined!");
    console.log("client.id:", client.id);
    console.log("client.sessionId:", client.sessionId);
    console.log("with options", options);
    this.state.lastMessage = `${ client.id } joined.`;
  }

  requestJoin (options, isNewRoom: boolean) {
    return true;
  }

  async onLeave (client, consented) {
    console.log("IS CONSENTED?", consented);

    try {
      if (consented) throw new Error("just close!");

      await this.allowReconnection(client, 10);
      console.log("CLIENT RECONNECTED");

    } catch (e) {
      this.state.lastMessage = `${client.id} left.`;
      console.log("ChatRoom:", client.sessionId, "left!");
    }
  }

  onMessage (client, data) {
    this.state.lastMessage = data;

    if (data === "leave") {
      this.disconnect().then(() => console.log("yup, disconnected."));
    }

    console.log("ChatRoom:", client.id, data);
  }

  onDispose () {
    console.log("Disposing ChatRoom...");

    // perform async tasks to disconnect all players
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log("async task finished, let's dispose the room now!")
        resolve();
      }, 2000);
    });
  }

}
