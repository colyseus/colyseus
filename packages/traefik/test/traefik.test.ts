import http from "http";
import assert from "assert";
import { Server } from "@colyseus/core";
import { exposeServerToTraefik } from "../src/index.ts";
import { RedisPresence } from "@colyseus/redis-presence";
import { WebSocketTransport } from "@colyseus/ws-transport";

describe("Traefik", () => {

  it("should expose the server to Traefik using HTTP provider", async () => {
    const port = 25678;
    const server = new Server({
      transport: new WebSocketTransport(),
      presence: new RedisPresence(),
      publicAddress: `localhost/${port}`,
      greet: false,
    });

    await server.listen(port);
    await exposeServerToTraefik({ server, provider: "http", mainAddress: "localhost" });

    const config: any = await get(`http://localhost:${port}/__traefik`);

    // Verify structure: http.routers and http.services exist
    assert.ok(config.http, "config should have 'http' property");
    assert.ok(config.http.routers, "config.http should have 'routers' property");
    assert.ok(config.http.services, "config.http should have 'services' property");

    // Verify "all-servers" router
    assert.ok(config.http.routers["all-servers"], "should have 'all-servers' router");
    assert.deepStrictEqual(config.http.routers["all-servers"].entryPoints, ["web"]);
    assert.strictEqual(config.http.routers["all-servers"].service, "all-servers");
    assert.strictEqual(config.http.routers["all-servers"].rule, "Host(`localhost`)");

    // Verify individual server router (localhost_25678)
    const serverRouterKey = `localhost_${port}`;
    assert.ok(config.http.routers[serverRouterKey], `should have '${serverRouterKey}' router`);
    assert.deepStrictEqual(config.http.routers[serverRouterKey].entryPoints, ["web"]);
    assert.strictEqual(config.http.routers[serverRouterKey].service, serverRouterKey);
    assert.strictEqual(config.http.routers[serverRouterKey].rule, `Host(\`localhost\`) && PathPrefix(\`/${port}\`)`);

    // Verify "all-servers" service with loadBalancer
    assert.ok(config.http.services["all-servers"], "should have 'all-servers' service");
    assert.ok(config.http.services["all-servers"].loadBalancer, "all-servers should have loadBalancer");
    assert.ok(Array.isArray(config.http.services["all-servers"].loadBalancer.servers), "loadBalancer should have servers array");

    // Verify individual server service (localhost_25678)
    assert.ok(config.http.services[serverRouterKey], `should have '${serverRouterKey}' service`);
    assert.ok(config.http.services[serverRouterKey].loadBalancer, `${serverRouterKey} should have loadBalancer`);
    assert.ok(Array.isArray(config.http.services[serverRouterKey].loadBalancer.servers), "loadBalancer should have servers array");
    assert.strictEqual(config.http.services[serverRouterKey].loadBalancer.servers.length, 1);

    await server.gracefullyShutdown(false);
  });
});

async function get(url: string) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    }).on('error', err => {
      reject(err);
    });
  });
}