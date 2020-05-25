import mongoose, { Document, Schema } from 'mongoose';
import { MatchMakerDriver, QueryHelpers, RoomListingData } from './Driver';

const RoomCacheSchema: Schema = new Schema<Document>({
  clients: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  maxClients: { type: Number, default: Infinity },
  metadata: Schema.Types.Mixed,
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

const RoomCache = mongoose.model<Document>('RoomCache', RoomCacheSchema);

export class MongooseDriver implements MatchMakerDriver {

  constructor(connectionURI?: string) {
    /* tslint:disable:no-string-literal */
    if (mongoose.connection.readyState === mongoose.connection.states['disconnected']) {
    /* tslint:enable:no-string-literal */
      mongoose.connect(connectionURI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus', {
        autoIndex: true,
        useCreateIndex: true,
        useFindAndModify: true,
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
    }
  }

  public createInstance(initialValues: any = {}) {
    return (new RoomCache(initialValues) as any) as RoomListingData;
  }

  public async find(conditions: any, additionalProjectionFields = {}) {
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

  public findOne(conditions: any) {
    return (RoomCache.findOne(conditions, {
      _id: 0,
      locked: 1,
      processId: 1,
      roomId: 1,
    })) as any as QueryHelpers<RoomListingData>;
  }

}
