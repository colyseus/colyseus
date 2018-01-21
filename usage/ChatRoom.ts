import { Room } from "../src";

export class ChatRoom extends Room<any> {

  onInit (options) {
    this.setState({ messages: [] });
  }

  onJoin (client, options) {
    console.log("client has joined!");
    console.log("client.id:", client.id);
    console.log("client.sessionId:", client.sessionId);
    console.log("with options", options);
    this.state.messages.push(`${ client.id } joined.`);
  }

  onLeave (client) {
    this.state.messages.push(`${ client.id } left.`);
  }

  onMessage (client, data) {
    this.state.messages.push(data.message);

    if (data.message === "leave") {
      this.disconnect();
    }

    console.log("ChatRoom:", client.id, data);
  }

  onDispose () {
    console.log("Disposing ChatRoom...");

    // perform async tasks to disconnect all players
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log("async task finished, let's dispose the room now!")
        reject();
      }, 2000);
    });
  }

}