import * as matchMaker from '../MatchMaker';
import { RoomListingData } from '../matchmaker/drivers/Driver';
import { subscribeLobby } from '../matchmaker/Lobby';
import { Room } from '../Room';
import { Client } from '../transport/Transport';

// TODO: use Schema state & filters on version 1.0.0

// class DummyLobbyState extends Schema { // tslint:disable-line
//   @type("number") public _: number;
// }

export interface FilterInput {
  name?: string;
  metadata?: any;
}

export interface LobbyOptions {
  filter?: FilterInput;
}

export class LobbyRoom extends Room { // tslint:disable-line
  public rooms: RoomListingData[] = [];
  public unsubscribeLobby: () => void;

  public clientOptions: { [sessionId: string]: LobbyOptions } = {};

  public async onCreate(options: any) {
    // prevent LobbyRoom to notify itself
    this.listing.unlisted = true;

    this.setState({});

    this.unsubscribeLobby = await subscribeLobby((roomId, data) => {
      const roomIndex = this.rooms.findIndex((room) => room.roomId === roomId);

      // console.log("LOBBY RECEIVING UPDATE:", { roomId, data, roomIndex });

      if (!data) {
        // remove room listing data
        if (roomIndex !== -1) {
          const previousData = this.rooms[roomIndex];

          this.rooms.splice(roomIndex, 1);

          this.clients.forEach((client) => {
            if (this.filterItemForClient(previousData, this.clientOptions[client.sessionId].filter)) {
              client.send('-', roomId);
            }
          });
        }

      } else if (roomIndex === -1) {
        // append room listing data
        this.rooms.push(data);

        this.clients.forEach((client) => {
          if (this.filterItemForClient(data, this.clientOptions[client.sessionId].filter)) {
            client.send('+', [roomId, data]);
          }
        });

      } else {
        const previousData = this.rooms[roomIndex];

        // replace room listing data
        this.rooms[roomIndex] = data;

        this.clients.forEach((client) => {
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

    this.onMessage('filter', (client: Client, filter: FilterInput) => {
      this.clientOptions[client.sessionId].filter = filter;
      client.send('rooms', this.filterItemsForClient(this.clientOptions[client.sessionId]));
    });
  }

  public onJoin(client: Client, options: LobbyOptions) {
    this.clientOptions[client.sessionId] = options || {};
    client.send('rooms', this.filterItemsForClient(this.clientOptions[client.sessionId]));
  }

  public onLeave(client: Client) {
    delete this.clientOptions[client.sessionId];
  }

  public onDispose() {
    if (this.unsubscribeLobby) {
      this.unsubscribeLobby();
    }
  }

  protected filterItemsForClient(options: LobbyOptions) {
    const filter = options.filter;

    return (filter)
      ? this.rooms.filter((room) => this.filterItemForClient(room, filter))
      : this.rooms;
  }

  protected filterItemForClient(room: RoomListingData, filter?: LobbyOptions['filter']) {
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
