# @colyseus/tunnel

Share the game running on your machine on a public URL, through Colyseus
Cloud. `https://<name>.play.colyseus.dev` reaches your local server: the
page, its WebSockets and WebTransport. Nothing on your side listens on the
internet, so it works from behind NAT and firewalls. Guide:
[Share your dev server](https://docs.colyseus.io/tools/tunnel).

## With Vite

Install it next to `colyseus`, then press `s` + enter in `vite dev`:

```sh
npm i -D @colyseus/tunnel
```

The first time, your browser opens Colyseus Cloud for you to log in. After
that, you get the URL and a QR code to open it on your phone. Press `s`
again to show them again.

```ts
colyseus({ serverEntry: "/src/server/index.ts", tunnel: { name: "mygame" } })
```

`tunnel: { name }` asks for `https://mygame.play.colyseus.dev`, and
`tunnel: false` removes the shortcut. Players can't load files from your
server entry's folder.

## From the command line

```sh
npx colyseus-tunnel 2567             # a random name
npx colyseus-tunnel -n mygame 2567   # https://mygame.play.colyseus.dev
npx colyseus-tunnel logout
```

## From code

```ts
import { openTunnel, qrCode } from "@colyseus/tunnel";

const tunnel = await openTunnel({ local: 2567 });
console.log(tunnel.url);
console.log(qrCode(tunnel.url));
await tunnel.close();
```

## Environment

- `COLYSEUS_CLOUD_TOKEN`: a tunnel token (`id|secret`), instead of logging in through the browser (CI, containers).
- `BROWSER=none`: print the login link rather than open it.
- `CLOUD_ENDPOINT`, `COLYSEUS_TUNNEL_EDGE`: another Colyseus Cloud, or another tunnel edge.
- `COLYSEUS_TUNNEL_AGENT`: your own `routez-tunnel-agent` binary.

Runs on macOS and Linux (x64 and arm64), and on Windows (x64).
