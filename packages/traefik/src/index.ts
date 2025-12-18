import { networkInterfaces } from 'os';
import { type Server, matchMaker, createEndpoint } from "@colyseus/core";
import { RedisPresence } from '@colyseus/redis-presence';

export interface TraefikOptions {
  /**
   * The server instance to expose to Traefik.
   */
  server: Server;

  /**
   * The provider to use for the Traefik config.
   * Defaults to "http".
   */
  provider?: "http" | "redis";

  /**
   * The main Traefik load balancer address.
   * Examples:
   *  - "backend.yourgamedomain.com"
   */
  mainAddress: string;

  /**
   * The internal address to use for the server. Port is optional and will be auto-detected if not provided.
   * Examples:
   *  - "192.168.1.100"
   *  - "127.0.0.1"
   *  - "localhost:2567"
   *  - "192.168.1.100:2567"
   */
  internalAddress?: string;

  /**
   * The root key to use for the Traefik configuration in Redis.
   * Defaults to "traefik".
   */
  redisRootKey?: string;

  /**
   * The health check options to use for the Traefik configuration.
   */
  healthCheckOptions?: { path: string; interval: string; timeout: string; };
}

export async function exposeServerToTraefik(options: TraefikOptions) {
  const { server } = options;
  const presence = matchMaker.presence;

  const mainAddress = options.mainAddress;
  const publicAddress = server.options.publicAddress;
  const subdomain = publicAddress?.replace("/", "_").split(".")?.[0];

  const internalAddress = options.internalAddress || autoDetectInternalIP();
  const internalPort = internalAddress?.indexOf(":") !== -1
    ? internalAddress.split(":")[1]
    : server['port'] || process.env.PORT;

  // Default to "http" provider if not provided
  if (!options.provider) { options.provider = "http"; }
  if (!options.redisRootKey) { options.redisRootKey = "traefik"; }
  if (!options.healthCheckOptions) {
    options.healthCheckOptions = { path: "/__healthcheck", interval: "10s", timeout: "5s" };
  }

  // Validate required options
  if (!mainAddress) {
    throw new Error("'mainAddress' is required. Use the Traefik load balancer address.");
  }
  if (!publicAddress) {
    throw new Error("'publicAddress' server option is required.");
  }
  if (!internalPort) {
    throw new Error("'port' is required. Use process.env.PORT or call `server.listen(port)` before calling `exposeServerToTraefik()`.");
  }
  if (!(presence instanceof RedisPresence)) {
    throw new Error("'presence' must be using RedisPresence.");
  }
  if (options.provider === "redis" && !(await isKeyspaceNotificationsEnabled(presence))) {
    throw new Error("Keyspace notifications are not enabled in Redis/Valkey. Please enable them in your Redis configuration. See: https://valkey.io/topics/notifications/#configuration");
  }

  const mainAddressKey = 'all-servers'

  /**
   * Set up Traefik router...
   */

  // ...for this server
  presence.set(`${options.redisRootKey}/http/routers/${subdomain}/rule`, buildTraefikRule(publicAddress));
  presence.set(`${options.redisRootKey}/http/routers/${subdomain}/service`, subdomain);

  // ...for this server's load balancer
  presence.set(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/servers/${subdomain}/url`, `http://${internalAddress}:${internalPort}`);
  presence.set(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/servers/${subdomain}/url`, `http://${internalAddress}:${internalPort}`);

  if (options.provider === "redis") {
    // Enable health check for this server
    presence.set(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/path`, options.healthCheckOptions.path);
    presence.set(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/interval`, options.healthCheckOptions.interval);
    presence.set(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/timeout`, options.healthCheckOptions.timeout);
    presence.set(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/healthcheck/path`, options.healthCheckOptions.path);
    presence.set(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/healthcheck/interval`, options.healthCheckOptions.interval);
    presence.set(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/healthcheck/timeout`, options.healthCheckOptions.timeout);
  }

  // ...for the "all servers" router
  const value = await presence.get(`${options.redisRootKey}/http/routers/${mainAddressKey}/rule`);
  if (!value) {
    presence.set(`${options.redisRootKey}/http/routers/${mainAddressKey}/rule`, buildTraefikRule(mainAddress));
    presence.set(`${options.redisRootKey}/http/routers/${mainAddressKey}/service`, mainAddressKey);
  }

  server.onShutdown(() => {
    // Remove this process from Traefik router and service
    presence.del(`${options.redisRootKey}/http/routers/${subdomain}/rule`);
    presence.del(`${options.redisRootKey}/http/routers/${subdomain}/service`);
    presence.del(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/servers/${subdomain}/url`);

    if (options.provider === "redis") {
      // Delete health check options
      presence.del(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/path`);
      presence.del(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/interval`);
      presence.del(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/healthcheck/timeout`);
    }

    // Remove this process from Traefik "all-servers" service
    presence.del(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/servers/${subdomain}/url`);
  });

  if (options.provider === "http") {
    server.router.addEndpoint(
      createEndpoint("/__traefik", { method: "GET" }, async (ctx) => {
        return ctx.json(await getTraefikConfigFromRedis(presence, options));
      })
    );
  }

}

/**
 * Reads all traefik/* keys from Redis and builds the Traefik HTTP provider config.
 */
async function getTraefikConfigFromRedis(presence: RedisPresence, options: TraefikOptions): Promise<object> {
  // Build the config object from key-value pairs
  const config: any = { http: { routers: {}, services: {} } };

  // Access the underlying ioredis client to scan keys
  const redis = (presence as any).pub;

  // Get all keys matching traefik/*
  const keys = await redis.keys(`${options.redisRootKey}/*`);

  // If no keys are found, return the empty config
  if (keys.length === 0) { return config; }

  // Get all values for the keys
  const values = await redis.mget(...keys);

  // Iterate over the keys and values and build the config object
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = values[i];

    if (!value) continue;

    // Parse key path: traefik/http/routers/name/property or traefik/http/services/name/loadbalancer/servers/serverId/url
    const parts = key.split('/');

    // Skip 'traefik' prefix
    if (parts[0] !== options.redisRootKey) continue;

    const protocol = parts[1]; // 'http'
    const type = parts[2]; // 'routers' or 'services'

    if (protocol === 'http' && type === 'routers') {
      // traefik/http/routers/{routerName}/{property}
      const routerName = parts[3];
      const property = parts[4]; // 'rule' or 'service'

      if (!config.http.routers[routerName]) {
        config.http.routers[routerName] = { entryPoints: ['web'] };
      }
      config.http.routers[routerName][property] = value;

    } else if (protocol === 'http' && type === 'services') {
      // traefik/http/services/{serviceName}/loadbalancer/servers/{serverId}/url
      const serviceName = parts[3];
      const serverId = parts[6];
      const property = parts[7]; // 'url'

      if (!config.http.services[serviceName]) {
        config.http.services[serviceName] = {
          loadBalancer: {
            servers: [] ,
            healthCheck: options.healthCheckOptions
          }
        };
      }

      // Add server URL to the servers array
      if (property === 'url') {
        config.http.services[serviceName].loadBalancer.servers.push({ url: value });
      }
    }
  }

  return config;
}

function buildTraefikRule(address: string) {
  if (!address.includes("://")) { address = "http://" + address; }

  const url = new URL(address);
  const rules: string[] = [`Host(\`${url.hostname}\`)`];

  if (url.pathname !== "/") {
    rules.push(`PathPrefix(\`${url.pathname}\`)`);
  }

  return rules.join(" && ");
}

function autoDetectInternalIP() {
  const nets = networkInterfaces();
  let ip;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ip = net.address;
        break;  // Take the first one
      }
    }
    if (ip) break;
  }

  return ip || '127.0.0.1';
}

/**
 * Checks if keyspace notifications are enabled for the given RedisPresence instance.
 * @param presence - The RedisPresence instance to check.
 * @returns True if keyspace notifications are enabled, false otherwise.
 */
async function isKeyspaceNotificationsEnabled(presence: RedisPresence): Promise<boolean> {
  // Access internal Redis client and duplicate it to use psubscribe
  const internalClient = (presence as any).pub;
  const redisClient = internalClient.duplicate();

  return await new Promise(async (resolve) => {
    const timeout = setTimeout(() => {
      redisClient.quit();
      resolve(false);
    }, 1100);

    await redisClient.psubscribe("__keyevent@0__:expired");
    redisClient.on("pmessage", () => {
      clearTimeout(timeout);
      redisClient.quit();
      resolve(true);
    });

    await presence.setex("test", "1", 1);
  });
}