import * as matchMaker from '../MatchMaker.ts';
import type { IRoomCache } from '../matchmaker/LocalDriver/LocalDriver.ts';
import type { Client } from '../Transport.ts';
import { subscribeLobby } from '../matchmaker/Lobby.ts';
import { Room } from '../Room.ts';

// TODO: use Schema state & filters on version 1.0.0

// class DummyLobbyState extends Schema { // tslint:disable-line
//   @type("number") public _: number;
// }

//
// Strongly-typed client messages for LobbyRoom
// (This is optional, but recommended for better type safety and code generation for native SDKs)
//
type LobbyClient = Client<{
  messages: {
    rooms: IRoomCache[];
    '+': [roomId: string, room: IRoomCache];
    '-': string;
  }
}>;

export interface FilterInput {
  name?: string;
  metadata?: any;
}

export interface LobbyOptions {
  filter?: FilterInput;
}

export class LobbyRoom<Metadata = any> extends Room {
  public rooms: IRoomCache<Metadata>[] = [];
  public unsubscribeLobby: () => void;

  public clientOptions: { [sessionId: string]: LobbyOptions } = {};

  messages = {
    filter: (client: LobbyClient, filter: FilterInput) => {
      const clientOptions = this.clientOptions[client.sessionId];
      if (!clientOptions) { return; }

      clientOptions.filter = filter;
      client.send('rooms', this.filterItemsForClient(clientOptions));
    }
  }

  public async onCreate(options: any) {
    // prevent LobbyRoom to notify itself
    this['_listing'].unlisted = true;

    this.unsubscribeLobby = await subscribeLobby((roomId, data) => {
      const roomIndex = this.rooms.findIndex((room) => room.roomId === roomId);
      const clients = this.clients.filter((client) => this.clientOptions[client.sessionId]);

      if (!data) {
        // remove room listing data
        if (roomIndex !== -1) {
          const previousData = this.rooms[roomIndex];

          this.rooms.splice(roomIndex, 1);

          clients.forEach((client) => {
            if (this.filterItemForClient(previousData, this.clientOptions[client.sessionId].filter)) {
              client.send('-', roomId);
            }
          });
        }

      } else if (roomIndex === -1) {
        // append room listing data
        this.rooms.push(data);

        clients.forEach((client) => {
          if (this.filterItemForClient(data, this.clientOptions[client.sessionId].filter)) {
            client.send('+', [roomId, data]);
          }
        });

      } else {
        const previousData = this.rooms[roomIndex];

        // replace room listing data
        this.rooms[roomIndex] = data;

        clients.forEach((client) => {
          const hadData = this.filterItemForClient(previousData, this.clientOptions[client.sessionId].filter);
          const hasData = this.filterItemForClient(data, this.clientOptions[client.sessionId].filter);

          if (hadData && !hasData) {
            client.send('-', roomId);

          } else if (hasData) {
            client.send('+', [roomId, data]);
          }
        });
      }
    });

    this.rooms = await matchMaker.query({ private: false, unlisted: false });
  }

  public onJoin(client: LobbyClient, options: LobbyOptions) {
    this.clientOptions[client.sessionId] = (
      !Array.isArray(options) && // Defold (Lua) sends empty objects as Array instead of object
      options
    ) || {};
    client.send('rooms', this.filterItemsForClient(this.clientOptions[client.sessionId]));
  }

  public onLeave(client: LobbyClient) {
    delete this.clientOptions[client.sessionId];
  }

  public onDispose() {
    if (this.unsubscribeLobby) {
      this.unsubscribeLobby();
    }
  }

  protected filterItemsForClient(options: LobbyOptions): IRoomCache<Metadata>[] {
    const filter = options.filter;

    return (filter)
      ? this.rooms.filter((room) => this.filterItemForClient(room, filter))
      : this.rooms;
  }

  protected filterItemForClient(room: IRoomCache, filter?: LobbyOptions['filter']) {
    if (!filter) {
      return true;
    }

    let isAllowed = true;

    if (filter.name !== room.name) {
      isAllowed = false;
    }

    if (filter.metadata) {
      for (const field in filter.metadata) {
        if (room.metadata[field] !== filter.metadata[field]) {
          isAllowed = false;
          break;
        }
      }
    }

    return isAllowed;
  }

}
