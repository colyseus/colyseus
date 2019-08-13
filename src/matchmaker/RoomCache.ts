import mongoose, { Schema, Document } from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus';
mongoose.connect(MONGO_URI, { autoIndex: true, useCreateIndex: true, useNewUrlParser: true });

export interface IRoomCache extends Document {
  name: string,
  roomId: string,
  processId: string,

  clients: number,
  maxClients: number,
  locked: boolean,

  query: any,
  metadata: any,
}

const RoomCacheSchema: Schema = new Schema<IRoomCache>({
  name: String,
  roomId: String,
  processId: String,

  clients: { type: Number, default: 0 },
  maxClients: { type: Number, default: Infinity },
  locked: { type: Boolean, default: false },

  query: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed
}, {
  timestamps: true,
  versionKey: false,
});

RoomCacheSchema.index({ name: 1, locked: -1 });
RoomCacheSchema.index({ roomId: 1 });

export const RoomCache = mongoose.model<IRoomCache>('RoomCache', RoomCacheSchema);
