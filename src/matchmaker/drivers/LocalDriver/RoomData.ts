import { spliceOne } from '../../../Utils';
import { RoomListingData } from '../Driver';

export class RoomCache implements RoomListingData {
  public clients: number = 0;
  public locked: boolean = false;
  public private: boolean = false;
  public maxClients: number = Infinity;
  public metadata: any;
  public name: string;
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

    this.$rooms = rooms;
  }

  public toJSON() {
    return {
      clients: this.clients,
      createdAt: this.createdAt,
      maxClients: this.maxClients,
      metadata: this.metadata,
      name: this.name,
      processId: this.processId,
      roomId: this.roomId,
    };
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
    const roomIndex = this.$rooms.indexOf(this);
    if (roomIndex === -1) { return; }

    spliceOne(this.$rooms, roomIndex);
    this.$rooms = null;
  }
}
