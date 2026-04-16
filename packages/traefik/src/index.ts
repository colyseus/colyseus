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
   * Defaults to "redis".
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
   * IPv6 addresses must be wrapped in brackets when including a port (per RFC 3986).
   * Examples:
   *  - "192.168.1.100"
   *  - "127.0.0.1"
   *  - "localhost:2567"
   *  - "192.168.1.100:2567"
   *  - "::1"
   *  - "fd12:3456:abcd::1"
   *  - "[::1]:2567"
   *  - "[fd12:3456:abcd::1]:2567"
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

  const { host: internalHost, port: internalPortFromAddress } =
    parseHostPort(options.internalAddress || autoDetectInternalIP());
  const internalPort = internalPortFromAddress || server['port'] || process.env.PORT;

  // Default to "http" provider if not provided
  if (!options.provider) { options.provider = "redis"; }
  if (!options.redisRootKey) { options.redisRootKey = "traefik"; }
  if (!options.healthCheckOptions) {
    options.healthCheckOptions = { path: "/__healthcheck", interval: "10s", timeout: "3s" };
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
  const internalUrl = buildInternalUrl(internalHost, internalPort);
  presence.set(`${options.redisRootKey}/http/services/${subdomain}/loadbalancer/servers/${subdomain}/url`, internalUrl);
  presence.set(`${options.redisRootKey}/http/services/${mainAddressKey}/loadbalancer/servers/${subdomain}/url`, internalUrl);

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

/**
 * Picks the first non-internal IPv4 address; falls back to the first
 * non-internal, non-link-local IPv6 (Railway and other IPv6-only private
 * networks have no routable IPv4 between containers).
 */
function autoDetectInternalIP() {
  const nets = networkInterfaces();
  let ipv4: string | undefined;
  let ipv6: string | undefined;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.internal) continue;
      if (net.family === 'IPv4' && !ipv4) {
        ipv4 = net.address;
      } else if (net.family === 'IPv6' && !ipv6 && !isLinkLocalIPv6(net.address)) {
        ipv6 = net.address;
      }
    }
  }

  return ipv4 || ipv6 || '127.0.0.1';
}

function isLinkLocalIPv6(address: string) {
  return address.toLowerCase().startsWith('fe80');
}

/**
 * Parse a host[:port] string. Supports:
 *  - "host"                  → { host: "host" }
 *  - "host:port"             → { host: "host", port: "port" }
 *  - "ipv4:port"             → { host: "ipv4", port: "port" }
 *  - "::1"                   → { host: "::1" }
 *  - "fd12:3456::1"          → { host: "fd12:3456::1" }
 *  - "[ipv6]"                → { host: "ipv6" }
 *  - "[ipv6]:port"           → { host: "ipv6", port: "port" }
 */
function parseHostPort(input: string): { host: string; port?: string } {
  if (input.startsWith('[')) {
    const end = input.indexOf(']');
    if (end === -1) {
      throw new Error(`Invalid bracketed address (missing ']'): ${input}`);
    }
    const host = input.slice(1, end);
    const rest = input.slice(end + 1);
    if (rest === '') return { host };
    if (rest.startsWith(':')) return { host, port: rest.slice(1) };
    throw new Error(`Invalid trailing characters after ']' in: ${input}`);
  }

  // 2+ colons → bare IPv6 without a port (port form would require brackets).
  const colonCount = (input.match(/:/g) || []).length;
  if (colonCount >= 2) return { host: input };

  const idx = input.indexOf(':');
  if (idx === -1) return { host: input };
  return { host: input.slice(0, idx), port: input.slice(idx + 1) };
}

function buildInternalUrl(host: string, port: string | number) {
  return host.includes(':')
    ? `http://[${host}]:${port}`
    : `http://${host}:${port}`;
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