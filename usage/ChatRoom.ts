import { Room } from '../src';

import { serialize } from '../src/serializer/Serializer';
import State from './State';

export class ChatRoom extends Room<State> {
  public maxClients = 4;

  public onInit(options) {
    this.setState(new State());
  }

  public async onAuth(options) {
    return { success: true };
  }

  public onJoin(client, options, auth) {
    console.log('client has joined!');
    console.log('client.id:', client.id);
    console.log('client.sessionId:', client.sessionId);
    console.log('with options', options);
    this.state.lastMessage = `${ client.id } joined.`;
  }

  public requestJoin(options, isNewRoom: boolean) {
    return (options.create)
      ? (options.create && isNewRoom)
      : this.clients.length > 0;
  }

  public async onLeave(client, consented) {
    console.log('IS CONSENTED?', consented);

    try {
      if (consented) { throw new Error('just close!'); }

      await this.allowReconnection(client, 10);
      console.log('CLIENT RECONNECTED');

    } catch (e) {
      this.state.lastMessage = `${client.id} left.`;
      console.log('ChatRoom:', client.sessionId, 'left!');
    }
  }

  public onMessage(client, data) {
    this.state.lastMessage = data;

    if (data === 'leave') {
      this.disconnect().then(() => console.log('yup, disconnected.'));
    }

    console.log('ChatRoom:', client.id, data);
  }

  public onDispose() {
    console.log('Disposing ChatRoom...');

    // perform async tasks to disconnect all players
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('async task finished, let\'s dispose the room now!');
        resolve();
      }, 2000);
    });
  }

}
