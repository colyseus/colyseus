import { MatchMakerDriver, QueryHelpers, RoomCacheData } from "./Driver";
import { spliceOne } from "../../Utils";

class RoomCache implements RoomCacheData {
  clients: number;
  locked: boolean;
  maxClients: number;
  metadata: any;
  name: string;
  processId: string;
  roomId: string;

  private $rooms: RoomCache[];

  constructor (initialValues: any, rooms) {
    for (let field in initialValues) {
      this[field] = initialValues[field];
    }

    this.$rooms = rooms;
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

  sort(options: any) {
  }

  then() {
    console.log("Query<T> => then()");
    const room: any = this.$rooms.find((room => {
      for (let field in this.conditions) {
        if (room[field] !== this.conditions[field]) {
          return false;
        }
      }
      return true;
    }));
    console.log("will return", room);
    return Promise.resolve(room);
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
    console.log("create new Query()");
    return new Query<RoomCacheData>(this.rooms, conditions) as any as QueryHelpers<RoomCacheData>;;
  }

}