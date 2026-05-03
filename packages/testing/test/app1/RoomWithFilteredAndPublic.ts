import { type Client, Room } from "@colyseus/core";
import { MapSchema, Schema, type, view } from "@colyseus/schema";

const AOI = 1;

export class FilteredEntity extends Schema {
  @type("string") sessionId: string;
  @type("uint16") tileX: number;
  @type("uint16") tileY: number;
  @type("uint16") hp: number;
}

export class PublicNested extends Schema {
  @type("string") mode: string = "";
  @type("uint16") tickCount: number = 0;
}

export class FilteredAndPublicState extends Schema {
  @view(AOI)
  @type({ map: FilteredEntity }) entities = new MapSchema<FilteredEntity>();

  @type(PublicNested) nested = new PublicNested();
}

/**
 * Reproduces colyseus/colyseus#935: when a room has both @view-filtered fields
 * and a non-@view nested Schema, the second filtered client to join after the
 * non-@view nested has been mutated receives a snapshot whose first patch
 * references refIds that were never introduced to its decoder. The fix in
 * SchemaSerializer.getFullState reorders view-changes introductions to come
 * before the encodeAll baseline.
 */
export class RoomWithFilteredAndPublic extends Room<FilteredAndPublicState> {
  state = new FilteredAndPublicState();

  onCreate() {
    this.state.nested.mode = "initial";
  }

  onJoin(client: Client) {
    const entity = new FilteredEntity();
    entity.sessionId = client.sessionId;
    entity.tileX = 0;
    entity.tileY = 0;
    entity.hp = 100;
    this.state.entities.set(client.sessionId, entity);
    if (client.view) {
      client.view.add(entity, AOI);
    }
  }

  onLeave(client: Client) {
    this.state.entities.delete(client.sessionId);
  }

  bumpNested(mode: string) {
    this.state.nested.mode = mode;
    this.state.nested.tickCount++;
  }
}
