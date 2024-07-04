import { IRoomCache, MatchMakerDriver, RoomCache, SortOptions, debugDriver } from '@colyseus/core';
import mongoose, { Document, Schema } from 'mongoose';

const RoomCacheSchema: Schema = new Schema({
  clients: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  maxClients: { type: Number, default: Infinity },
  metadata: Schema.Types.Mixed,
  name: String,
  private: { type: Boolean, default: false },
  publicAddress: String,
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

const RoomCache = mongoose.model<Document>('RoomCache', RoomCacheSchema);

export class MongooseDriver implements MatchMakerDriver {

  constructor(connectionURI?: string) {

    if (mongoose.connection.readyState === mongoose.STATES.disconnected) {
      connectionURI = connectionURI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus';

      mongoose.connect(connectionURI, {
        autoIndex: true,
        autoCreate: true,
      });

      debugDriver("🗄️ Connected to", connectionURI);
    }
  }

  public createInstance(initialValues: any = {}) {
    return (new RoomCache(initialValues) as any);
  }

  public async has(roomId: string) {
    return !!(await RoomCache.findOne({ roomId }));
  };

  public query(conditions: Partial<IRoomCache>, sortOptions: SortOptions = {}) {
    let query = RoomCache.find(conditions, {
      _id: false,
      clients: true,
      createdAt: true,
      locked: true,
      maxClients: true,
      metadata: true,
      name: true,
      roomId: true,
    });

    if (sortOptions) {
      query = query.sort(sortOptions);
    }

    return query as any as IRoomCache[];
  }

  public findOne(conditions: Partial<IRoomCache>, sortOptions?: SortOptions) {
    let query = RoomCache.findOne(conditions, { _id: 0 });

    if (sortOptions) {
      query = query.sort(sortOptions);
    }

    return query as any as Promise<RoomCache>;
  }

  public async clear() {
    await RoomCache.deleteMany({});
  }

  public async cleanup(processId: string) {
    await RoomCache.deleteMany({ processId });
  }

  public async shutdown() {
    await mongoose.disconnect();
  }
}
