# @colyseus/geoip

Country-level GeoIP plugin for Colyseus rooms. Resolves the client's IP at
auth time and attaches `client.geoip` before `onJoin` runs.

```ts
import { Room, definePlugins } from "@colyseus/core";
import { GeoIPPlugin } from "@colyseus/geoip";

class MyRoom extends Room {
  plugins = definePlugins([
    new GeoIPPlugin({ dbPath: "./GeoLite2-Country.mmdb" }),
  ]);

  async onJoin(client) {
    console.log(client.geoip);
    // { isoCode: "BR", name: "Brazil", continent: "SA", isInEU: false }
  }
}
```

`client.geoip` is `undefined` for unresolvable IPs (loopback, RFC1918,
IPv6 link-local, or simply absent from the database). Lookup failures
never block the join.

## Database delivery modes

The plugin reads any [MMDB](https://maxmind.github.io/MaxMind-DB/) file —
the binary format shared by MaxMind GeoLite2 and DB-IP Lite. Three ways
to point it at one:

### 1. `dbPath` — bring your own file

```ts
new GeoIPPlugin({ dbPath: "/var/lib/geoip/GeoLite2-Country.mmdb" })
```

Use this with MaxMind's [`geoipupdate`](https://github.com/maxmind/geoipupdate)
cron, a custom build step that fetches DB-IP, or any other workflow you
already have.

### 2. `accountId` + `licenseKey` — auto-fetch from MaxMind

```ts
new GeoIPPlugin({
  accountId: process.env.MAXMIND_ACCOUNT_ID,
  licenseKey: process.env.MAXMIND_LICENSE_KEY,
  // optional:
  cacheDir: "/var/cache/colyseus-geoip",
  refreshIntervalMs: 7 * 24 * 60 * 60 * 1000, // weekly
})
```

Downloads `GeoLite2-Country.mmdb` under your MaxMind credentials on the
first boot, caches to disk, and refreshes weekly. Sign up at
<https://www.maxmind.com/en/geolite2/signup> to get credentials.

### 3. DB-IP Lite — no configuration

```ts
new GeoIPPlugin()

// optional:
new GeoIPPlugin({ cacheDir: "/var/cache/colyseus-geoip" })
```

Downloads DB-IP's Lite Country database from db-ip.com on the first boot
— no account, no credentials — and caches it to disk. DB-IP publishes a
new snapshot on the 1st of each month; the plugin checks daily and picks
it up when it lands, falling back to last month's until it does.

The database is fetched rather than shipped inside this package: ~4 MB
over the wire, 8 MB on disk, and only for the people who use this mode.
It needs outbound network access on the first boot — in an air-gapped
deployment, use mode 1 with a file you place yourself.

## Licensing and attribution

This plugin reads two independently-licensed databases. **What you owe
depends on which mode you use.**

### MaxMind GeoLite2 (modes 1 & 2)

GeoLite2 data is provided under the
[GeoLite2 EULA](https://www.maxmind.com/en/geolite2/eula). Key terms:

- Free for use under your MaxMind account, including commercial use.
- **Cannot be redistributed**; each user must download under their own
  credentials. The plugin does not bundle MaxMind data.
- Cannot be used for FCRA-regulated decisions (credit, insurance,
  employment, government benefits).
- Attribution required if you expose the data: *"This product includes
  GeoLite2 data created by MaxMind, available from
  <https://www.maxmind.com>."*

### DB-IP Lite (mode 3)

DB-IP's Lite databases are licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
This package does not redistribute them — mode 3 downloads the file from
db-ip.com onto your machine — so the attribution obligation is yours as
the operator, not ours:

> *IP-to-country data from DB-IP.com, available under CC BY 4.0 from
> <https://db-ip.com/db/lite.php>.*

DB-IP asks that web applications displaying results from the database
link back to db-ip.com. If your game surfaces country information to
players, use their suggested credit:

```html
<a href="https://db-ip.com">IP Geolocation by DB-IP</a>
```

## Privacy

The plugin derives country from the client's IP. The IP is already
visible to your server; the resolved country is the same class of
personal data and should be treated as such under GDPR/CCPA/etc. If you
persist `client.geoip` beyond the session, disclose it in your privacy
policy.

## Manually testing the auto-downloader

`AutoDownloader` is exercised by a standalone script rather than the
mocha suite — it needs live MaxMind credentials and network access.

```sh
MAXMIND_ACCOUNT_ID=... MAXMIND_LICENSE_KEY=... \
  pnpm tsx scripts/test-autodownloader.ts

# Exercise the cross-process race fix by forking N peers:
MAXMIND_ACCOUNT_ID=... MAXMIND_LICENSE_KEY=... \
  pnpm tsx scripts/test-autodownloader.ts --force --concurrent 4
```

The `--concurrent` mode forks N child processes that all call `fetch()`
against the same cache directory, then asserts every child ended up with
an identical sha256 — verifying that PID-scoped temp paths and the
recheck-before-rename keep peers from clobbering each other's writes.
