import type { RoomListingData, QueryHelpers, IRoomListingData, MatchMakerDriver } from '@colyseus/core';
import { debugDriver } from '@colyseus/core';
import type { Document } from 'mongoose';
import Mongoose from 'mongoose';

const RoomCacheSchema: Mongoose.Schema = new Mongoose.Schema({
  clients: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  maxClients: { type: Number, default: Infinity },
  metadata: Mongoose.Schema.Types.Mixed,
  name: String,
  private: { type: Boolean, default: false },
  processId: String,
  roomId: String,
  unlisted: { type: Boolean, default: false }, // used for default LobbyRoom (prevent from showing up on room listing)
}, {
  strict: false,
  timestamps: true,
  versionKey: false,
});

RoomCacheSchema.index({ name: 1, locked: -1 });
RoomCacheSchema.index({ roomId: 1 });

const RoomCache = Mongoose.model<Document>('RoomCache', RoomCacheSchema);

export class MongooseDriver implements MatchMakerDriver {
  constructor(connectionURI?: string) {
    if (Mongoose.connection.readyState === Mongoose.STATES.disconnected) {
      connectionURI = connectionURI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus';

      Mongoose.connect(connectionURI, {
        autoIndex: true,
      });

      debugDriver("🗄️ Connected to", connectionURI);
    }
  }

  public createInstance(initialValues: any = {}) {
    return (new RoomCache(initialValues) as any) as RoomListingData;
  }

  public async find(conditions: Partial<IRoomListingData>, additionalProjectionFields = {}) {
    return (await RoomCache.find(conditions, {
      _id: false,
      clients: true,
      createdAt: true,
      locked: true,
      maxClients: true,
      metadata: true,
      name: true,
      roomId: true,
      ...additionalProjectionFields,
    })) as any as RoomListingData[];
  }

  public findOne(conditions: Partial<IRoomListingData>) {
    return (RoomCache.findOne(conditions, {
      _id: 0,
    })) as any as QueryHelpers<RoomListingData>;
  }

  public async clear() {
    await RoomCache.deleteMany({});
  }

  public async shutdown() {
    await Mongoose.disconnect();
  }
}
