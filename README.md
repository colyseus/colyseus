<div align="center">
  <a href="https://github.com/gamestdio/colyseus">
    <img src="media/header.png?raw=true" />
  </a>
  <br>
  <br>
  <a href="https://npmjs.com/package/colyseus">
    <img src="https://img.shields.io/npm/dm/colyseus.svg">
  </a>
  <a href="https://patreon.com/endel" title="Donate to this project using Patreon">
    <img src="https://img.shields.io/badge/patreon-donate-yellow.svg" alt="Patreon donate button" />
  </a>
  <a href="http://discuss.colyseus.io" title="Discuss on Forum">
    <img src="https://img.shields.io/badge/discuss-on%20forum-brightgreen.svg?style=flat&colorB=b400ff" alt="Discussion forum" />
  </a>
  <a href="https://gitter.im/gamestdio/colyseus">
    <img src="https://badges.gitter.im/gamestdio/colyseus.svg">
  </a>
  <h3>
    Multiplayer Game Server for Node.js. <a href="https://github.com/gamestdio/colyseus/wiki">View documentation</a>
  <h3>
</div>

Read the [version 0.5.0 update](https://medium.com/@endel/colyseus-html5-multiplayer-games-made-simple-v0-6-0-alpha-update-d5d0e5eba4a0).

## Why?

Writing your own multiplayer boilerplate using Socket.io/SockJS/etc is time
consuming and you'll face a range of different problems along the way. Colyseus
should have all these problems figured out already.

## Features / Characteristics

- Authoritative game server
- WebSocket-based communication
- Binary delta compressed state (through [msgpack](http://msgpack.org) / [fossil-delta-js](https://github.com/dchest/fossil-delta-js))
- Match-making
- Custom room handlers
- Scalable vertically
- Lag compensation (using [timeframe](http://github.com/gamestdio/timeframe), a
  Timeline implementation) - Not automatic. You should apply the technique as you need, in the client and/or the server.

See [roadmap](https://github.com/gamestdio/colyseus/wiki/Roadmap) for our future plans.

### Official client integration

- [JavaScript/TypeScript](https://github.com/gamestdio/colyseus.js)
- [Unity](https://github.com/gamestdio/colyseus-unity3d)
- [CoronaSDK](https://github.com/gamestdio/colyseus.lua) (compatible with server v0.3.x)

### Community client integration

- [Construct2](https://github.com/polpoy/colyseus-construct-plugin) (compatible with server v0.4.0)
- [Cocos2d-x](https://github.com/chunho32/colyseus-cocos2d-x) (compatible with server v0.4.0)

### Usage examples

See the [official examples](https://github.com/gamestdio/colyseus-examples) for
usage reference with the latest version of Colyseus.

- (outdated: v0.2.x) [tanx](https://playcanvas.com/project/367035/overview/tanxcolyseus) ([source-code](https://github.com/endel/tanx)) - Multiplayer tanks game, originally from [PlayCanvas](https://tanx.io/)
- (outdated: v0.3.x) [tic-tac-toe](https://tictactoe-colyseus.herokuapp.com) ([source-code](https://github.com/endel/tic-tac-toe)) - Simple Tic Tac Toe using [pixi.js](https://github.com/pixijs/pixi.js)
- (outdated: v0.3.x) [LD35 entry: dotower](http://ludumdare.com/compo/ludum-dare-35/?action=preview&uid=50958) ([source-code](https://github.com/endel/LD35)) - Simple experimental MOBA using [pixi.js](https://github.com/pixijs/pixi.js)
- (outdated: v0.4.x) [React Example](https://colyseus-react-example.herokuapp.com) ([source-code](https://github.com/endel/colyseus-react-example)) - Example integrating with [ReactJS](https://github.com/facebook/react)

# Contributors

Thanks goes to these wonderful people ([emoji key](https://github.com/kentcdodds/all-contributors#emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
| [<img src="https://avatars3.githubusercontent.com/u/130494?v=4" width="100px;"/><br /><sub><b>Endel Dreyer</b></sub>](https://twitter.com/endel)<br />[💻](https://github.com/endel/all-contributors/commits?author=endel "Code") [📖](https://github.com/endel/all-contributors/commits?author=endel "Documentation") [💡](#example-endel "Examples") | [<img src="https://avatars2.githubusercontent.com/u/20824844?v=4" width="100px;"/><br /><sub><b>AnubisCode</b></sub>](https://github.com/AnubisCode)<br />[🐛](https://github.com/endel/all-contributors/issues?q=author%3AAnubisCode "Bug reports") [💻](https://github.com/endel/all-contributors/commits?author=AnubisCode "Code") [💵](#financial-AnubisCode "Financial") | [<img src="https://avatars0.githubusercontent.com/u/763609?v=4" width="100px;"/><br /><sub><b>Kyle J. Kemp</b></sub>](http://seiyria.com)<br />[💬](#question-seiyria "Answering Questions") [🐛](https://github.com/endel/all-contributors/issues?q=author%3Aseiyria "Bug reports") [💻](https://github.com/endel/all-contributors/commits?author=seiyria "Code") [🤔](#ideas-seiyria "Ideas, Planning, & Feedback") | [<img src="https://avatars1.githubusercontent.com/u/1041315?v=4" width="100px;"/><br /><sub><b>Abhishek Hingnikar</b></sub>](https://github.com/darkyen)<br />[💬](#question-darkyen "Answering Questions") [🐛](https://github.com/endel/all-contributors/issues?q=author%3Adarkyen "Bug reports") [🤔](#ideas-darkyen "Ideas, Planning, & Feedback") [👀](#review-darkyen "Reviewed Pull Requests") | [<img src="https://avatars2.githubusercontent.com/u/21344385?v=4" width="100px;"/><br /><sub><b>Federico</b></sub>](https://twitter.com/Federkun)<br />[🐛](https://github.com/endel/all-contributors/issues?q=author%3AFederkun "Bug reports") [💻](https://github.com/endel/all-contributors/commits?author=Federkun "Code") | [<img src="https://avatars0.githubusercontent.com/u/853683?v=4" width="100px;"/><br /><sub><b>OYED</b></sub>](https://oyed.io)<br />[🐛](https://github.com/endel/all-contributors/issues?q=author%3Aoyed "Bug reports") [💵](#financial-oyed "Financial") [🤔](#ideas-oyed "Ideas, Planning, & Feedback") | [<img src="https://avatars0.githubusercontent.com/u/13785893?v=4" width="100px;"/><br /><sub><b>Derwish</b></sub>](https://github.com/derwish-pro)<br />[🐛](https://github.com/endel/all-contributors/issues?q=author%3Aderwish-pro "Bug reports") [🔧](#tool-derwish-pro "Tools") |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| [<img src="https://avatars2.githubusercontent.com/u/2755221?v=4" width="100px;"/><br /><sub><b>VF</b></sub>](https://github.com/havingfunq)<br />[🐛](https://github.com/endel/all-contributors/issues?q=author%3Ahavingfunq "Bug reports") [🤔](#ideas-havingfunq "Ideas, Planning, & Feedback") |
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification.
Contributions of any kind are welcome!

# Contributing

We encourage you to contribute to Colyseus! Please check out the [Contributing
guide](.github/CONTRIBUTING.md) for guidelines about how to proceed. Join us!

Everyone interacting in Colyseus and its sub-projects' codebases, issue trackers
and chat rooms is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

MIT
