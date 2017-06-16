import { Room } from "../src";

export class ChatRoom extends Room<any> {

  onInit (options) {
    this.setState({ messages: [] });
  }

  onJoin (client, options) {
    console.log("client has joined!", client, options);
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
    console.log("Dispose ChatRoom");
  }

}
