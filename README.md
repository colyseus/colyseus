<div align="center">
  <a href="https://github.com/colyseus/colyseus">
    <img src="media/header.png?raw=true" />
  </a>
  <br>
  <br>
  <a href="https://npmjs.com/package/colyseus">
    <img src="https://img.shields.io/npm/dm/colyseus.svg?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QAAKqNIzIAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAAHdElNRQfjAgETESWYxR33AAAAtElEQVQoz4WQMQrCQBRE38Z0QoTcwF4Qg1h4BO0sxGOk80iCtViksrIQRRBTewWxMI1mbELYjYu+4rPMDPtn12ChMT3gavb4US5Jym0tcBIta3oDHv4Gwmr7nC4QAxBrCdzM2q6XqUnm9m9r59h7Rc0n2pFv24k4ttGMUXW+sGELTJjSr7QDKuqLS6UKFChVWWuFkZw9Z2AAvAirKT+JTlppIRnd6XgaP4goefI2Shj++OnjB3tBmHYK8z9zAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDE5LTAyLTAxVDE4OjE3OjM3KzAxOjAwGQQixQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAxOS0wMi0wMVQxODoxNzozNyswMTowMGhZmnkAAAAZdEVYdFNvZnR3YXJlAHd3dy5pbmtzY2FwZS5vcmeb7jwaAAAAAElFTkSuQmCC">
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

> ⭐️ Enjoying Colyseus? Show your support by starring the project on GitHub ⭐️

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
# 🏟 Colyseus Arena: Fast & Scalable Cloud Hosting

- Looking for a fully managed solution for your Colyseus game server?
- Want to focus on game development and not on the hosting and infrastructure?
- Launching a production title and need a solution for 1,000 to 100,000+ CCUs?

If so [Colyseus Arena](https://www.colyseus.io/arena) cloud hosting is the solution you are looking for. Easily upload your existing Colyseus Server code and get started today for Free!

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

- [Tech Demo: Shooting Gallery](https://github.com/colyseus/unity-demo-shooting-gallery) - Unity + Colyseus "Shooting Gallery" Tech Demo
- [Colyseus + PixiJS Boilerplate](https://colyseus-pixijs-boilerplate.herokuapp.com/) ([source-code](https://github.com/endel/colyseus-pixijs-boilerplate)) - Simplistic agar.io implementation using [PixiJS](https://github.com/pixijs/pixi.js)
- [Colyseus + BabylonJS Boilerplate](https://babylonjs-multiplayer.herokuapp.com/) ([source-code](https://github.com/endel/babylonjs-multiplayer-boilerplate)) - Bare-bones [BabylonJS](https://github.com/BabylonJS/Babylon.js) example
- [Tic Tac Toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe)) - Tic Tac Toe using [PixiJS](https://github.com/pixijs/pixi.js) and [Defold Engine](https://defold.com)
- [Collaborative Drawing Prototype](https://colyseus-drawing-prototype.herokuapp.com/) ([source-code](https://github.com/endel/colyseus-collaborative-drawing)) - Collaborative drawing using HTML5 canvas.
- (outdated: < v0.8.x): [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus), [react-example](https://github.com/endel/colyseus-react-example), [LD35 entry: dotower](http://ludumdare.com/compo/ludum-dare-35/?action=preview&uid=50958)

# Contributors

Thanks goes to these wonderful people ([emoji key](https://github.com/kentcdodds/all-contributors#emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/halftheopposite/"><img src="https://avatars0.githubusercontent.com/u/5473864?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Aymeric Chauvin</b></sub></a><br /><a href="#question-halftheopposite" title="Answering Questions">💬</a> <a href="#example-halftheopposite" title="Examples">💡</a></td>
    <td align="center"><a href="https://github.com/brian-hay"><img src="https://avatars2.githubusercontent.com/u/1428000?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Brian Hay</b></sub></a><br /><a href="#content-brian-hay" title="Content">🖋</a></td>
    <td align="center"><a href="https://github.com/damian-pastorini"><img src="https://avatars2.githubusercontent.com/u/1211779?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Damian A. Pastorini</b></sub></a><br /><a href="#question-damian-pastorini" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/commits?author=damian-pastorini" title="Documentation">📖</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3Adamian-pastorini" title="Bug reports">🐛</a></td>
    <td align="center"><a href="https://github.com/Zielak"><img src="https://avatars0.githubusercontent.com/u/625693?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Darek Greenly</b></sub></a><br /><a href="#question-Zielak" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3AZielak" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=Zielak" title="Code">💻</a></td>
    <td align="center"><a href="https://github.com/Vidski"><img src="https://avatars.githubusercontent.com/u/36316706?v=4?s=100" width="100px;" alt=""/><br /><sub><b>David Rydwanski</b></sub></a><br /><a href="#question-Vidski" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/commits?author=Vidski" title="Code">💻</a></td>
    <td align="center"><a href="https://github.com/drburton"><img src="https://avatars0.githubusercontent.com/u/625595?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Dr. Burton</b></sub></a><br /><a href="#mentoring-drburton" title="Mentoring">🧑‍🏫</a></td>
    <td align="center"><a href="https://twitter.com/endel"><img src="https://avatars3.githubusercontent.com/u/130494?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Endel Dreyer</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/commits?author=endel" title="Code">💻</a> <a href="https://github.com/colyseus/colyseus/commits?author=endel" title="Documentation">📖</a> <a href="#example-endel" title="Examples">💡</a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/enriqueto"><img src="https://avatars2.githubusercontent.com/u/5557196?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Enriqueto</b></sub></a><br /><a href="#business-enriqueto" title="Business development">💼</a></td>
    <td align="center"><a href="https://github.com/fazriz"><img src="https://avatars0.githubusercontent.com/u/2628698?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Fazri Zubair</b></sub></a><br /><a href="#question-fazriz" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/commits?author=fazriz" title="Code">💻</a> <a href="#ideas-fazriz" title="Ideas, Planning, & Feedback">🤔</a> <a href="#business-fazriz" title="Business development">💼</a></td>
    <td align="center"><a href="https://twitter.com/Federkun"><img src="https://avatars2.githubusercontent.com/u/21344385?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Federico</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/issues?q=author%3AFederkun" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=Federkun" title="Code">💻</a></td>
    <td align="center"><a href="https://github.com/mobyjames/"><img src="https://avatars0.githubusercontent.com/u/1327007?v=4?s=100" width="100px;" alt=""/><br /><sub><b>James Jacoby</b></sub></a><br /><a href="#question-mobyjames" title="Answering Questions">💬</a> <a href="#example-mobyjames" title="Examples">💡</a> <a href="#content-mobyjames" title="Content">🖋</a></td>
    <td align="center"><a href="http://wenish.github.io/portfolio/"><img src="https://avatars0.githubusercontent.com/u/18367963?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Jonas Voland</b></sub></a><br /><a href="#question-Wenish" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3AWenish" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=Wenish" title="Code">💻</a> <a href="#ideas-Wenish" title="Ideas, Planning, & Feedback">🤔</a> <a href="#example-Wenish" title="Examples">💡</a></td>
    <td align="center"><a href="http://seiyria.com"><img src="https://avatars0.githubusercontent.com/u/763609?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Kyle J. Kemp</b></sub></a><br /><a href="#question-seiyria" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3Aseiyria" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=seiyria" title="Code">💻</a> <a href="#ideas-seiyria" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/LukeWood/"><img src="https://avatars0.githubusercontent.com/u/12191303?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Luke Wood</b></sub></a><br /><a href="#question-LukeWood" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3ALukeWood" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=LukeWood" title="Code">💻</a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/doorbash"><img src="https://avatars2.githubusercontent.com/u/5982526?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Milad Doorbash</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/issues?q=author%3Adoorbash" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=doorbash" title="Code">💻</a></td>
    <td align="center"><a href="https://github.com/TinyDobbins"><img src="https://avatars2.githubusercontent.com/u/20824844?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Nikita Borisov</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/issues?q=author%3ATinyDobbins" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=TinyDobbins" title="Code">💻</a> <a href="#business-TinyDobbins" title="Business development">💼</a> <a href="#ideas-TinyDobbins" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://acemobe.com/"><img src="https://avatars2.githubusercontent.com/u/232101?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Phil Harvey</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/commits?author=filharvey" title="Documentation">📖</a></td>
    <td align="center"><a href="https://github.com/serjek"><img src="https://avatars2.githubusercontent.com/u/18265157?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Sergey</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/issues?q=author%3Aserjek" title="Bug reports">🐛</a> <a href="https://github.com/colyseus/colyseus/commits?author=serjek" title="Code">💻</a></td>
    <td align="center"><a href="https://oyed.io"><img src="https://avatars0.githubusercontent.com/u/853683?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Tom</b></sub></a><br /><a href="#question-oyed" title="Answering Questions">💬</a> <a href="https://github.com/colyseus/colyseus/issues?q=author%3Aoyed" title="Bug reports">🐛</a> <a href="#ideas-oyed" title="Ideas, Planning, & Feedback">🤔</a></td>
    <td align="center"><a href="https://github.com/supertommy"><img src="https://avatars0.githubusercontent.com/u/2236153?v=4?s=100" width="100px;" alt=""/><br /><sub><b>Tommy Leung</b></sub></a><br /><a href="#mentoring-supertommy" title="Mentoring">🧑‍🏫</a></td>
    <td align="center"><a href="https://github.com/digimbyte"><img src="https://avatars2.githubusercontent.com/u/6645396?v=4?s=100" width="100px;" alt=""/><br /><sub><b>digimbyte</b></sub></a><br /><a href="https://github.com/colyseus/colyseus/commits?author=digimbyte" title="Documentation">📖</a></td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification.
Contributions of any kind are welcome!

# Contributing

We encourage you to contribute to Colyseus! Please check out the [Contributing
guide](.github/CONTRIBUTING.md) for guidelines about how to proceed. Join us!

Everyone interacting in Colyseus and its sub-projects' codebases, issue trackers
and chat rooms is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

# Backers / Supporters via Patreon

As of February 2021, Colyseus is owned and sponsored by [Lucid Sight](https://www.lucidsight.com/). A warm **thank you** for previous supporters of the project is forever documented in the [early supporters wiki page](https://github.com/colyseus/colyseus/wiki/Early-supporters-(2017-2021)).

# License

MIT
