<div align="center">
  <a href="https://github.com/colyseus/colyseus">
    <img src="media/header.png?raw=true" />
  </a>
  <br>
  <br>
  <a href="https://npmjs.com/package/colyseus">
    <img src="https://img.shields.io/npm/dm/colyseus.svg?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QAAKqNIzIAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAAHdElNRQfjAgETESWYxR33AAAAtElEQVQoz4WQMQrCQBRE38Z0QoTcwF4Qg1h4BO0sxGOk80iCtViksrIQRRBTewWxMI1mbELYjYu+4rPMDPtn12ChMT3gavb4US5Jym0tcBIta3oDHv4Gwmr7nC4QAxBrCdzM2q6XqUnm9m9r59h7Rc0n2pFv24k4ttGMUXW+sGELTJjSr7QDKuqLS6UKFChVWWuFkZw9Z2AAvAirKT+JTlppIRnd6XgaP4goefI2Shj++OnjB3tBmHYK8z9zAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDE5LTAyLTAxVDE4OjE3OjM3KzAxOjAwGQQixQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAxOS0wMi0wMVQxODoxNzozNyswMTowMGhZmnkAAAAZdEVYdFNvZnR3YXJlAHd3dy5pbmtzY2FwZS5vcmeb7jwaAAAAAElFTkSuQmCC">
  </a>
  <a href="https://patreon.com/endel" title="Donate to this project using Patreon">
    <img src="https://img.shields.io/badge/dynamic/json?logo=patreon&style=for-the-badge&color=%23e85b46&label=Patreon&query=data.attributes.patron_count&suffix=%20backers&url=https%3A%2F%2Fwww.patreon.com%2Fapi%2Fcampaigns%2F365642" alt="Patreon donate button"/>
  </a>
  <a href="http://discuss.colyseus.io" title="Discuss on Forum">
    <img src="https://img.shields.io/badge/discuss-on%20forum-brightgreen.svg?style=for-the-badge&colorB=0069b8&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QAAKqNIzIAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAAHdElNRQfjAgETDROxCNUzAAABB0lEQVQoz4WRvyvEARjGP193CnWRH+dHQmGwKZtFGcSmxHAL400GN95ktIpV2dzlLzDJgsGgGNRdDAzoQueS/PgY3HXHyT3T+/Y87/s89UANBKXBdoZo5J6L4K1K5ZxHfnjnlQUf3bKvkgy57a0r9hS3cXfMO1kWJMza++tj3Ac7/LY343x1NA9cNmYMwnSS/SP8JVFuSJmr44iFqvtmpjhmhBCrOOazCesq6H4P3bPBjFoIBydOk2bUA17I080Es+wSZ51B4DIA2zgjSpYcEe44Js01G0XjRcCU+y4ZMrDeLmfc9EnVd5M/o0VMeu6nJZxWJivLmhyw1WHTvrr2b4+2OFqra+ALwouTMDcqmjMAAAAldEVYdGRhdGU6Y3JlYXRlADIwMTktMDItMDFUMTg6MTM6MTkrMDE6MDAC9f6fAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDE5LTAyLTAxVDE4OjEzOjE5KzAxOjAwc6hGIwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAASUVORK5CYII=" alt="Discussion forum" />
  </a>
  <a href="https://discord.gg/RY8rRS7">
    <img src="https://img.shields.io/discord/525739117951320081.svg?style=for-the-badge&colorB=7581dc&logo=discord&logoColor=white">
  </a>
  <h3>
    Multiplayer Framework for Node.js. <br /><a href="https://docs.colyseus.io/">View documentation</a>
  </h3>
</div>

Colyseus is an Authoritative Multiplayer Framework for Node.js, with clients
available for the Web, Unity3d, Defold, Haxe, and Cocos2d-X. ([See official clients](#%EF%B8%8F-official-client-integration))

The project focuses on providing synchronizable data structures for realtime and
turn-based games, matchmaking, and ease of usage both on the server-side and
client-side.

The mission of the framework is to be a standard netcode & matchmaking solution
for any kind of project you can think of!

You're encouraged to take a look on [some games being developed with
it](https://discuss.colyseus.io/category/5/showcase) and make your own!

## What Colyseus provides to you:

- WebSocket-based communication
- Simple API in the server-side and client-side.
- Automatic state synchronization between server and client.
- Matchmaking clients into game sessions
- Scale vertically or horizontally

## What Colyseus won't provide:

- Game Engine: Colyseus is agnostic of the engine you're using. Need Physics? Add your own logic / package.
- Database: It's up to you to configure and select which database you'd like to use.

See [roadmap](https://github.com/colyseus/colyseus/wiki/Roadmap) for our future plans.

# 🚀 Quickstart

Create a bare-bones Colyseus server by using `npm init colyseus-app`.

```
npm init colyseus-app my-colyseus-server
cd my-colyseus-server
npm start
```

# 🕹️ Official Client Integration

- [JavaScript/TypeScript](https://github.com/colyseus/colyseus.js)
- [Unity](https://github.com/colyseus/colyseus-unity3d) ([unity3d.com](https://unity3d.com/))
- [Defold Engine](https://github.com/colyseus/colyseus-defold) ([defold.com](https://www.defold.com/))
- [Haxe](https://github.com/colyseus/colyseus-hx) ([haxe.org](https://haxe.org/))
- [Construct 3](https://github.com/colyseus/colyseus-construct3) ([construct3.net](https://www.construct.net/))
- [Cocos2d-x](https://github.com/colyseus/colyseus-cocos2d-x) ([cocos2d-x.org](https://cocos2d-x.org/))

# 🛠️ Tools

- [@colyseus/social](https://github.com/colyseus/colyseus-social) - Authentication and Social features for Colyseus
- [@colyseus/proxy](https://github.com/colyseus/proxy) - Proxy & Service Discovery for scaling Colyseus
- [@colyseus/monitor](https://github.com/colyseus/colyseus-monitor) - A Web Monitoring Panel for Colyseus
- [@colyseus/loadtest](https://github.com/colyseus/colyseus-loadtest) - Utility tool for load testing Colyseus

## Tools made by the community ❤️

- [colyseus-hxjs](https://github.com/serjek/colyseus-hxjs): Haxe externs for colyseus server (by [@serjek](https://github.com/serjek))
- [colyseus-kotlin](https://github.com/doorbash/colyseus-kotlin): Client for Java/Kotlin (by [@doorbash](https://github.com/doorbash))
- [Stencyl Extension](http://community.stencyl.com/index.php/topic,61150.0.html): [Stencyl](http://stencyl.com) extension to communicate with a Colyseus server (by [MdotEdot](http://www.stencyl.com/users/index/32424))
- [Colyseus-ObjC](https://github.com/swittk/Colyseus-ObjC): Client for Objective C (by [@swittk](https://github.com/swittk))
- [Colyseus-for-C2](https://github.com/Keevle/Colyseus-for-C2): Client for Construct 2 (by [@Keevle](https://github.com/Keevle))

# Usage examples

See the [official examples](https://github.com/colyseus/colyseus-examples) for
usage reference with the latest version of Colyseus.

- [Colyseus + PixiJS Boilerplate](https://colyseus-pixijs-boilerplate.herokuapp.com/) ([source-code](https://github.com/endel/colyseus-pixijs-boilerplate)) - Simplistic agar.io implementation using [PixiJS](https://github.com/pixijs/pixi.js)
- [Colyseus + BabylonJS Boilerplate](https://babylonjs-multiplayer.herokuapp.com/) ([source-code](https://github.com/endel/babylonjs-multiplayer-boilerplate)) - Bare-bones [BabylonJS](https://github.com/BabylonJS/Babylon.js) example
- [Tic Tac Toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe)) - Tic Tac Toe using [PixiJS](https://github.com/pixijs/pixi.js) and [Defold Engine](https://defold.com)
- [Collaborative Drawing Prototype](https://colyseus-drawing-prototype.herokuapp.com/) ([source-code](https://github.com/endel/colyseus-collaborative-drawing)) - Collaborative drawing using HTML5 canvas.
- (outdated: < v0.8.x): [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus), [react-example](https://github.com/endel/colyseus-react-example), [LD35 entry: dotower](http://ludumdare.com/compo/ludum-dare-35/?action=preview&uid=50958)

# Contributors

Thanks goes to these wonderful people ([emoji key](https://github.com/kentcdodds/all-contributors#emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
| [<img src="https://avatars3.githubusercontent.com/u/130494?v=4" width="100px;" alt="Endel Dreyer"/><br /><sub><b>Endel Dreyer</b></sub>](https://twitter.com/endel)<br />[💻](https://github.com/gamestdio/colyseus/commits?author=endel "Code") [📖](https://github.com/gamestdio/colyseus/commits?author=endel "Documentation") [💡](#example-endel "Examples") | [<img src="https://avatars0.githubusercontent.com/u/763609?v=4" width="100px;" alt="Kyle J. Kemp"/><br /><sub><b>Kyle J. Kemp</b></sub>](http://seiyria.com)<br />[💬](#question-seiyria "Answering Questions") [🐛](https://github.com/gamestdio/colyseus/issues?q=author%3Aseiyria "Bug reports") [💻](https://github.com/gamestdio/colyseus/commits?author=seiyria "Code") [💵](#financial-seiyria "Financial") [🤔](#ideas-seiyria "Ideas, Planning, & Feedback") | [<img src="https://avatars0.githubusercontent.com/u/18367963?v=4" width="100px;" alt="Jonas Voland"/><br /><sub><b>Jonas Voland</b></sub>](http://wenish.github.io/portfolio/)<br />[💬](#question-Wenish "Answering Questions") [🐛](https://github.com/gamestdio/colyseus/issues?q=author%3AWenish "Bug reports") [💻](https://github.com/gamestdio/colyseus/commits?author=Wenish "Code") [💵](#financial-Wenish "Financial") [🤔](#ideas-Wenish "Ideas, Planning, & Feedback") | [<img src="https://avatars2.githubusercontent.com/u/5982526?v=4" width="100px;" alt="Milad Doorbash"/><br /><sub><b>Milad Doorbash</b></sub>](https://github.com/doorbash)<br />[🐛](https://github.com/gamestdio/colyseus/issues?q=author%3Adoorbash "Bug reports") [💻](https://github.com/gamestdio/colyseus/commits?author=doorbash "Code") | [<img src="https://avatars0.githubusercontent.com/u/853683?v=4" width="100px;" alt="Tom"/><br /><sub><b>Tom</b></sub>](https://oyed.io)<br />[💬](#question-oyed "Answering Questions") [🐛](https://github.com/gamestdio/colyseus/issues?q=author%3Aoyed "Bug reports") [🤔](#ideas-oyed "Ideas, Planning, & Feedback") | [<img src="https://avatars0.githubusercontent.com/u/1327007?v=4" width="100px;" alt="James Jacoby"/><br /><sub><b>James Jacoby</b></sub>](https://github.com/mobyjames/)<br />[💡](#example-mobyjames "Examples") [💵](#financial-mobyjames "Financial") [🖋](#content-mobyjames "Content") | [<img src="https://avatars2.githubusercontent.com/u/20824844?v=4" width="100px;" alt="Nikita Borisov"/><br /><sub><b>Nikita Borisov</b></sub>](https://github.com/TinyDobbins)<br />[🐛](https://github.com/gamestdio/colyseus/issues?q=author%3ATinyDobbins "Bug reports") [💻](https://github.com/gamestdio/colyseus/commits?author=TinyDobbins "Code") [💵](#financial-TinyDobbins "Financial") [🤔](#ideas-TinyDobbins "Ideas, Planning, & Feedback") |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| [<img src="https://avatars2.githubusercontent.com/u/232101?v=4" width="100px;" alt="Phil Harvey"/><br /><sub><b>Phil Harvey</b></sub>](https://acemobe.com/)<br />[💵](#financial-filharvey "Financial") [📖](https://github.com/gamestdio/colyseus/commits?author=filharvey "Documentation") | [<img src="https://avatars2.githubusercontent.com/u/1428000?v=4" width="100px;" alt="Brian Hay"/><br /><sub><b>Brian Hay</b></sub>](https://github.com/brian-hay)<br />[💵](#financial-brian-hay "Financial") | [<img src="https://avatars2.githubusercontent.com/u/5557196?v=4" width="100px;" alt="Enriqueto"/><br /><sub><b>Enriqueto</b></sub>](https://github.com/enriqueto)<br />[💵](#financial-enriqueto "Financial") | [<img src="https://avatars2.githubusercontent.com/u/6645396?v=4" width="100px;" alt="digimbyte"/><br /><sub><b>digimbyte</b></sub>](https://github.com/digimbyte)<br />[📖](https://github.com/gamestdio/colyseus/commits?author=digimbyte "Documentation") | [<img src="https://avatars2.githubusercontent.com/u/21344385?v=4" width="100px;" alt="Federico"/><br /><sub><b>Federico</b></sub>](https://twitter.com/Federkun)<br />[🐛](https://github.com/gamestdio/colyseus/issues?q=author%3AFederkun "Bug reports") [💻](https://github.com/gamestdio/colyseus/commits?author=Federkun "Code") | [<img src="https://avatars0.githubusercontent.com/u/13785893?v=4" width="100px;" alt="Derwish"/><br /><sub><b>Derwish</b></sub>](https://github.com/derwish-pro)<br />[🐛](https://github.com/gamestdio/colyseus/issues?q=author%3Aderwish-pro "Bug reports") [🔧](#tool-derwish-pro "Tools") |
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification.
Contributions of any kind are welcome!

# Contributing

We encourage you to contribute to Colyseus! Please check out the [Contributing
guide](.github/CONTRIBUTING.md) for guidelines about how to proceed. Join us!

Everyone interacting in Colyseus and its sub-projects' codebases, issue trackers
and chat rooms is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

# Backers / Supporters via Patreon

**Sponsors**
- BubbleboxGames

**Generous backers:**
- Pavel Leonov
- Soatok Dreamseeker
- Adrian Lotta
- Kevin Hayes
- Mobile Brain
- Wenish

**Backers:**
- Vincent Chabrette
- Aymeric Chauvin
- Ell Tee
- dstrawberrygirl
- Sergey On Line
- Vitaliy Rotari
- Paul Sawaya
- Brian Peiris
- Dr. Brian Burton
- Jake Cattrall
- Kirill
- Emy
- Eric Hasnoname
- Matt Greene
- Thomas Summerall
- Joshua Jebadurai
- Hooman Niktafar
- Mikal Dev
- Eric McDaniel
- Damian Alberto Pastorini
- tobi4s1337
- enriqueto
- Worph
- João Mosmann
- Brian Hay
- Plaid World

# License

MIT
