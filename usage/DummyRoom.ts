import { Room } from "../src";
import { Schema, type } from "@colyseus/schema";

class Message extends Schema {
  @type("string") str;
  @type("number") num;
}

class State extends Schema {
  @type("string")
  lastMessage: string = "";
}

export class DummyRoom extends Room<State> {
  maxClients = 4;

  onCreate (options) {
    console.log("CREATE ROOM WITH OPTIONS", options);
    this.setMetadata({ password: true });

    this.setState(new State());
  }

  async onAuth (client, options, req) {
    // console.log("headers:", req.headers);
    // console.log("remoteAddress:", req.connection.remoteAddress)

    return { success: true };
  }

  onJoin (client, options, auth) {
    console.log(`client "${client.sessionId}" has joined, options =>`, options);
    console.log("auth response =>", auth);
    this.state.lastMessage = `${ client.sessionId } joined.`;
  }

  async onLeave (client, consented) {
    console.log("IS CONSENTED?", consented);

    try {
      if (consented) throw new Error("just close!");

      // await this.allowReconnection(client, 10);
      console.log("CLIENT RECONNECTED");

    } catch (e) {
      this.state.lastMessage = `${client.sessionId} left.`;
      console.log("ChatRoom:", client.sessionId, "left!");
    }
  }

  onMessage (client, data) {
    this.state.lastMessage = data;

    if (data === "schema") {
      const message = new Message();
      message.str = "Hello world!";
      message.num = 10;
      this.send(client, message);
    }

    if (data === "leave") {
      this.disconnect().then(() => console.log("yup, disconnected."));
    }

    console.log("ChatRoom:", client.sessionId, data);
  }

  onDispose () {
    console.log("Disposing ChatRoom...");

    // // perform async tasks to disconnect all players
    // return new Promise((resolve, reject) => {
    //   setTimeout(() => {
    //     console.log("async task finished, let's dispose the room now!")
    //     resolve();
    //   }, 1000);
    // });
  }

}
