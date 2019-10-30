import { Schema, type } from '@colyseus/schema';
import { Room } from '../Room';

class RoomData extends Schema { // tslint:disable-line
  @type('string') public id: string;
  @type('string') public name: string;
  @type('number') public clients: number;
  @type('number') public maxClients: number;
  @type('string') public metadata: string;
}

class LobbyState extends Schema { // tslint:disable-line
  @type([RoomData]) public rooms: RoomData[];
}

export class LobbyRoom extends Room<LobbyState> { // tslint:disable-line

  public onCreate(options: any) {
    this.setState(new LobbyState());
    this.clock.setInterval(() => this.fetch(), Math.max(1, options.updateInterval || 5000) * 1000);
  }

  public fetch() {
    // TODO: make .driver available on this scope!
  }

  public onMessage() {
    // TODO:
  }

  public onDispose() {
    // TODO:
  }

}
