import './Room.ext.ts';

import { Server, type SDKTypes } from "@colyseus/core";
import { type ConfigOptions, listen } from "@colyseus/tools";
import { ColyseusTestServer } from './TestServer.ts';

const DEFAULT_TEST_PORT = 2568;

export async function boot<ServerType extends SDKTypes = any>(config: ConfigOptions & ServerType, port?: number): Promise<ColyseusTestServer<ServerType>>;
export async function boot(config: Server, port?: number): Promise<ColyseusTestServer<any>>;
export async function boot(config: ConfigOptions | Server, port: number = DEFAULT_TEST_PORT) {
  if (config instanceof Server) {
    const gameServer = config;
    await gameServer.listen(DEFAULT_TEST_PORT);
    return new ColyseusTestServer(gameServer);

  } else {
    if (!config.options) { config.options = {}; }

    // override server options for testing.
    config.options.devMode = false;
    config.options.greet = false;
    config.options.gracefullyShutdown = false;

    // Force LocalDriver & LocalPresence ??
    // config.options.driver = new LocalDriver();
    // config.options.presence = new LocalPresence();

    const gameServer = await listen({ ...config, displayLogs: false, }, port);
    return new ColyseusTestServer(gameServer);
  }
}

export { ColyseusTestServer };
