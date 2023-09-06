import { spliceOne } from '../../utils/Utils';
import { RoomListingData } from './interfaces';

export class RoomCache implements RoomListingData {
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

  constructor(initialValues: any, rooms: RoomCache[]) {
    this.createdAt = new Date();

    for (const field in initialValues) {
      if (initialValues.hasOwnProperty(field)) {
        this[field] = initialValues[field];
      }
    }

    // make $rooms non-enumerable, so it can be serialized (circular references)
    Object.defineProperty(this, '$rooms', {
      enumerable: false,
      value: rooms,
      writable: true,
    });
  }

  public async save() {
    if (this.$rooms.indexOf(this) === -1) {
      this.$rooms.push(this);
    }
  }

  public async updateOne(operations: any) {
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

  public async remove() {
    //
    // WORKAROUND: prevent calling `.remove()` multiple times
    // Seems to happen during disconnect + dispose: https://github.com/colyseus/colyseus/issues/390
    //
    if (!this.$rooms) {
      return 0;
    }

    const roomIndex = this.$rooms.indexOf(this);

    if (roomIndex === -1) {
      return 0;
    }

    spliceOne(this.$rooms, roomIndex);
    this.$rooms = null;

    return 1;
  }
}
