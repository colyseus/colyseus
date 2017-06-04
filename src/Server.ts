import { IServerOptions } from "uws";

export class Server {
  constructor (options?: IServerOptions) {
    throw new Error(`'Server' has been deprecated on version 0.5.x. Use 'ClusterServer' instead.
Learn how to migrate here: https://github.com/gamestdio/colyseus/blob/master/MIGRATING.md#migrating-from-04-to-05`);
  }
}
