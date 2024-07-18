import { spliceOne } from '../../../utils/Utils.js';
import { RoomCache, IRoomCache } from '../api.js';

export class RoomData implements RoomCache {
  public clients: number = 0;
  public locked: boolean = false;
  public private: boolean = false;
  public maxClients: number = Infinity;
  public metadata: any;
  public name: string;
  public publicAddress: string;
  public processId: string;
  public roomId: string;
  public createdAt: Date;
  public unlisted: boolean = false;

  private $rooms: RoomCache[];

  constructor(initialValues: any, rooms: IRoomCache[]) {
    this.createdAt = new Date();

    for (const field in initialValues) {
      if (initialValues.hasOwnProperty(field)) {
        this[field] = initialValues[field];
      }
    }

    // make $rooms non-enumerable, so it can be serialized (circular references)
    Object.defineProperty(this, "$rooms", {
      value: rooms,
      enumerable: false,
      writable: true,
    });
  }

  public save() {
    if (this.$rooms.indexOf(this) === -1) {
      this.$rooms.push(this);
    }
  }

  public updateOne(operations: any) {
    if (operations.$set) {
      for (const field in operations.$set) {
        if (operations.$set.hasOwnProperty(field)) {
          this[field] = operations.$set[field];
        }
      }
    }

    if (operations.$inc) {
      for (const field in operations.$inc) {
        if (operations.$inc.hasOwnProperty(field)) {
          this[field] += operations.$inc[field];
        }
      }
    }
  }

  public remove() {
    //
    // WORKAROUND: prevent calling `.remove()` multiple times
    // Seems to happen during disconnect + dispose: https://github.com/colyseus/colyseus/issues/390
    //
    if (!this.$rooms) { return; }

    const roomIndex = this.$rooms.indexOf(this);
    if (roomIndex === -1) { return; }

    spliceOne(this.$rooms, roomIndex);
    this.$rooms = null;
  }
}
