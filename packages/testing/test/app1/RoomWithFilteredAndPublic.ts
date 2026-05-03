import { type Client, Room } from "@colyseus/core";
import { MapSchema, Schema, StateView, type, view } from "@colyseus/schema";

const AOI = 1;

export class FilteredEntity extends Schema {}

export class PublicNested extends Schema {
  @type("string") mode: string = "";
  @type("uint16") tickCount: number = 0;
}

export class FilteredAndPublicState extends Schema {
  @view(AOI)
  @type({ map: FilteredEntity }) entities = new MapSchema<FilteredEntity>();

  @type(PublicNested) nested = new PublicNested();
}

export class RoomWithFilteredAndPublic extends Room<FilteredAndPublicState> {
  state = new FilteredAndPublicState();

  onJoin(client: Client) {
    const entity = new FilteredEntity();
    this.state.entities.set(client.sessionId, entity);

    client.view = new StateView();
    client.view.add(entity, AOI);
  }

  bumpNested(mode: string) {
    this.state.nested.mode = mode;
    this.state.nested.tickCount++;
  }
}
