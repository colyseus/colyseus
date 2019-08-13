import mongoose, { Document, Schema } from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/colyseus';
mongoose.connect(MONGO_URI, {
  autoIndex: true,
  useCreateIndex: true,
  useFindAndModify: true,
  useNewUrlParser: true,
});

export interface RoomCacheData extends Document {
  clients: number;
  locked: boolean;
  maxClients: number;
  metadata: any;
  name: string;
  processId: string;
  roomId: string;
}

const RoomCacheSchema: Schema = new Schema<RoomCacheData>({
  clients: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
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

RoomCacheSchema.index({ name: 1, locked: -1 });
RoomCacheSchema.index({ roomId: 1 });

export const RoomCache = mongoose.model<RoomCacheData>('RoomCache', RoomCacheSchema);
