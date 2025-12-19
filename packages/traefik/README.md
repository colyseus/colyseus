# @colyseus/traefik

Utility to dynamically expose Colyseus servers to [Traefik](https://traefik.io/) as a load balancer.

This module automatically registers and de-registers Colyseus server instances with Traefik, enabling dynamic scaling and routing without manual configuration changes.

## Features

- **Dynamic registration**: Automatically registers server instances with Traefik on startup
- **Auto cleanup**: Automatically de-registers on graceful shutdown
- **Sticky sessions**: Routes clients to specific server instances via subdomain-based routing
- **Load balancing**: Maintains an "all-servers" service for distributing new connections
- **Health checks**: Built-in health check configuration support
- **Config Providers**: Supports both Redis and HTTP Traefik providers

## Requirements

- **Redis/Valkey** with Keyspace Notifications enabled (for Redis provider)
- **@colyseus/redis-presence** for presence management
- **Traefik v2+** configured with Redis or HTTP provider

### Enabling Keyspace Notifications in Redis

For the Redis provider, keyspace notifications must be enabled. Add this to your Redis configuration:

```
notify-keyspace-events Ex
```

Or run: `redis-cli config set notify-keyspace-events Ex`

## Installation

```bash
npm install @colyseus/traefik
```

## Usage

```typescript
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { exposeServerToTraefik } from "@colyseus/traefik";

const server = new Server({
  transport: new WebSocketTransport(),
  presence: new RedisPresence(),
  publicAddress: "node-1.yourgamedomain.com", // Unique address for this server instance
});

await server.listen(2567);

// Expose this server to Traefik
await exposeServerToTraefik({
  server,
  mainAddress: "backend.yourgamedomain.com", // Main load balancer address
});
```

## API

### `exposeServerToTraefik(options: TraefikOptions)`

Registers the Colyseus server with Traefik for load balancing.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `server` | `Server` | **required** | The Colyseus server instance to expose |
| `mainAddress` | `string` | **required** | The main Traefik load balancer address (e.g., `"backend.yourgamedomain.com"`) |
| `provider` | `"http"` \| `"redis"` | `"redis"` | The Traefik provider to use |
| `internalAddress` | `string` | auto-detected | Internal IP/hostname for the server. Port is auto-detected if not provided (e.g., `"192.168.1.100"` or `"192.168.1.100:2567"`) |
| `redisRootKey` | `string` | `"traefik"` | The root key for Traefik configuration in Redis |
| `healthCheckOptions` | `object` | see below | Health check configuration |

#### Default Health Check Options

```typescript
{
  path: "/__healthcheck",
  interval: "10s",
  timeout: "3s"
}
```

## Traefik Configuration

### Option 1: Redis Provider (Recommended)

The Redis provider allows Traefik to read configuration directly from Redis, providing real-time updates when servers join or leave.

**`traefik.yml`:**

```yaml
providers:
  redis:
    rootKey: "traefik"
    endpoints:
      - "127.0.0.1:6379"

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
```

**Colyseus setup:**

```typescript
await exposeServerToTraefik({
  server,
  provider: "redis",
  mainAddress: "backend.yourgamedomain.com",
});
```

### Option 2: HTTP Provider

The HTTP provider exposes a `/__traefik` endpoint on your Colyseus server that Traefik polls for configuration updates.

**`traefik.yml`:**

```yaml
providers:
  http:
    endpoint: "http://127.0.0.1:2567/__traefik"
    pollInterval: "5s"

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
```

**Colyseus setup:**

```typescript
await exposeServerToTraefik({
  server,
  provider: "http",
  mainAddress: "backend.yourgamedomain.com",
});
```

## How It Works

### Routing Architecture

This module creates two types of routes in Traefik:

1. **Main load balancer route** (`mainAddress`)
   - Routes to an "all-servers" service
   - Distributes new connections across all available server instances
   - Example: `backend.yourgamedomain.com`

2. **Per-server routes** (derived from `publicAddress`)
   - Each server gets its own subdomain-based route
   - Enables sticky sessions by routing clients to specific servers
   - Example: `node-1.yourgamedomain.com`, `node-2.yourgamedomain.com`

### Redis Key Structure

When using the Redis provider, the module creates keys in the following structure:

```
traefik/http/routers/{routerName}/rule
traefik/http/routers/{routerName}/service
traefik/http/services/{serviceName}/loadbalancer/servers/{serverId}/url
traefik/http/services/{serviceName}/loadbalancer/healthcheck/path
traefik/http/services/{serviceName}/loadbalancer/healthcheck/interval
traefik/http/services/{serviceName}/loadbalancer/healthcheck/timeout
```

### Lifecycle

1. **On startup**: Server registers itself with Traefik via Redis keys
2. **During operation**: Traefik routes traffic based on the registered configuration
3. **On shutdown**: Server removes its keys from Redis, automatically deregistering from Traefik

## Example: Multi-Server Setup

```typescript
// Server 1 (node-1.yourgamedomain.com)
const server1 = new Server({
  transport: new WebSocketTransport(),
  presence: new RedisPresence(),
  publicAddress: "node-1.yourgamedomain.com",
});

await server1.listen(2567);
await exposeServerToTraefik({
  server: server1,
  mainAddress: "backend.yourgamedomain.com",
  internalAddress: "192.168.1.101:2567",
});

// Server 2 (node-2.yourgamedomain.com)
const server2 = new Server({
  transport: new WebSocketTransport(),
  presence: new RedisPresence(),
  publicAddress: "node-2.yourgamedomain.com",
});

await server2.listen(2568);
await exposeServerToTraefik({
  server: server2,
  mainAddress: "backend.yourgamedomain.com",
  internalAddress: "192.168.1.102:2568",
});
```

With this setup:
- New clients connecting to `backend.yourgamedomain.com` are load-balanced across both servers
- Clients can connect directly to `node-1.yourgamedomain.com` or `node-2.yourgamedomain.com` for sticky sessions
- When reconnecting to a specific room, the SDK uses the server's `publicAddress` to route directly to the correct instance

## License

MIT
