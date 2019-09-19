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
      _id: 0,
      clients: 1,
      createdAt: 1,
      maxClients: 1,
      metadata: 1,
      name: 1,
      roomId: 1,
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
