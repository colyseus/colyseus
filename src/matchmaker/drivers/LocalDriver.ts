import { spliceOne } from "../../Utils";
import { MatchMakerDriver, QueryHelpers, RoomListingData } from "./Driver";
import { SortOptions } from "../RegisteredHandler";

class RoomCache implements RoomListingData {
  clients: number = 0;
  locked: boolean = false;
  private: boolean = false;
  maxClients: number = Infinity;
  metadata: any;
  name: string;
  processId: string;
  roomId: string;
  createdAt: Date;

  private $rooms: RoomCache[];

  constructor (initialValues: any, rooms: RoomCache[]) {
    this.createdAt = new Date();

    for (let field in initialValues) {
      this[field] = initialValues[field];
    }

    this.$rooms = rooms;
  }

  toJSON () {
    return {
      clients: this.clients,
      maxClients: this.maxClients,
      metadata: this.metadata,
      name: this.name,
      processId: this.processId,
      roomId: this.roomId,
      createdAt: this.createdAt,
    }
  }

  save() {
    if (this.$rooms.indexOf(this) === -1) {
      this.$rooms.push(this);
    }
  }

  updateOne(operations: any) {
    if (operations.$set) {
      for (let field in operations.$set) {
        this[field] = operations.$set[field];
      }
    }

    if (operations.$inc) {
      for (let field in operations.$inc) {
        this[field] += operations.$inc[field];
      }
    }
  }

  remove() {
    spliceOne(this.$rooms, this.$rooms.indexOf(this));
    this.$rooms = null;
  }
}

class Query<T> implements QueryHelpers<T> {
  private $rooms: T[];
  private conditions: any;

  constructor (rooms, conditions) {
    this.$rooms = rooms;
    this.conditions = conditions;
  }

  sort(options: SortOptions) {
    this.$rooms = this.$rooms.sort((room1, room2) => {
      for (let field in options) {
        const direction = options[field];
        const isAscending = (direction === 1 || direction === 'asc' || direction === "ascending");

        if (isAscending) {
          if (room1[field] > room2[field]) return 1;
          if (room1[field] < room2[field]) return -1;

        } else {
          if (room1[field] > room2[field]) return -1;
          if (room1[field] < room2[field]) return 1;
        }
      }
    });
  }

  then(resolve, reject) {
    const room: any = this.$rooms.find((room => {
      for (let field in this.conditions) {
        if (room[field] !== this.conditions[field]) {
          return false;
        }
      }
      return true;
    }));
    return resolve(room);
  }
}

export class LocalDriver implements MatchMakerDriver {
  rooms: RoomCache[] = [];

  createInstance(initialValues: any = {}) {
    return new RoomCache(initialValues, this.rooms);
  }

  find(conditions: any) {
    return this.rooms.filter((room => {
      for (let field in conditions) {
        if (room[field] !== conditions[field]) {
          return false;
        }
      }
      return true;
    }));
  }

  findOne(conditions: any) {
    return new Query<RoomListingData>(this.rooms, conditions) as any as QueryHelpers<RoomListingData>;;
  }

}