import mongoose, { Document, Schema } from 'mongoose';
import { MatchMakerDriver, RoomListingData, QueryHelpers } from './Driver';

export interface RoomCacheEntry extends Document { }

const RoomCacheSchema: Schema = new Schema<RoomCacheEntry>({
  clients: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  private: { type: Boolean, default: false },
  maxClients: { type: Number, default: Infinity },
  metadata: Schema.Types.Mixed,
  name: String,
  processId: String,
  roomId: String,
}, {
  strict: false,
  timestamps: true,
  versionKey: false,
});

// RoomCacheSchema.methods.toJSON = function() {
//   var obj = this.toObject()
//   delete obj.locked;
//   return obj
// }

RoomCacheSchema.index({ name: 1, locked: -1 });
RoomCacheSchema.index({ roomId: 1 });

const RoomCache = mongoose.model<RoomCacheEntry>('RoomCache', RoomCacheSchema);

export class MongooseDriver implements MatchMakerDriver {

  constructor (connectionURI?: string) {
    if (mongoose.connection.readyState === mongoose.connection.states['disconnected']) {
      mongoose.connect(connectionURI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus', {
        autoIndex: true,
        useCreateIndex: true,
        useFindAndModify: true,
        useNewUrlParser: true,
      });
    }
  }

  createInstance(initialValues: any = {}) {
    return (new RoomCache(initialValues) as any) as RoomListingData;
  }

  async find(conditions: any, additionalProjectionFields = {}) {
    return (await RoomCache.find(conditions, {
      _id: 0,
      clients: 1,
      maxClients: 1,
      metadata: 1,
      name: 1,
      roomId: 1,
      ...additionalProjectionFields
    })) as any as RoomListingData[];
  }

  findOne(conditions: any) {
    return (RoomCache.findOne(conditions, {
      _id: 0,
      processId: 1,
      roomId: 1,
      locked: 1
    })) as any as QueryHelpers<RoomListingData>;
  }

}

