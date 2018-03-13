import { Room } from "../src";

export class ChatRoom extends Room<any> {
  maxClients = 4;

  onInit (options) {
    console.log("onInit:", options)
    this.setState({ messages: [] });
  }

  onJoin (client, options) {
    console.log("client has joined!");
    console.log("client.id:", client.id);
    console.log("client.sessionId:", client.sessionId);
    console.log("with options", options);
    this.state.messages.push(`${ client.id } joined.`);
  }

  requestJoin (options, isNewRoom: boolean) {
    return (options.create && isNewRoom) || this.clients.length > 0;
  }

  onLeave (client) {
    this.state.messages.push(`${ client.id } left.`);
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
