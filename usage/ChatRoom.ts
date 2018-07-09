import { Room } from "../src";

export class ChatRoom extends Room<any> {
  maxClients = 4;

  onInit (options) {
    this.setState({ messages: [] });
  }

  async onAuth (options) {
    return { success: true };
  }

  onJoin (client, options, auth) {
    console.log("client has joined!");
    console.log("client.id:", client.id);
    console.log("client.sessionId:", client.sessionId);
    console.log("with options", options);
    this.state.messages.push(`${ client.id } joined.`);
  }

  requestJoin (options, isNewRoom: boolean) {
    return (options.create)
      ? (options.create && isNewRoom)
      : this.clients.length > 0;
  }

  async onLeave (client, consented) {
    console.log("IS CONSENTED?", consented);

    try {
      if (consented) throw new Error("just close!");

      await this.allowReconnection(client, 10);
      console.log("CLIENT RECONNECTED");

    } catch (e) {
      this.state.messages.push(`${client.id} left.`);
      console.log("ChatRoom:", client.sessionId, "left!");
    }
  }

  onMessage (client, data) {
    this.state.messages.push(data);

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
