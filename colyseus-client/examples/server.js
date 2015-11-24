var colyseus = require('colyseus')
  , ChatRoom = require('./rooms/chat_room')
  , BattleRoom = require('./rooms/battle_room')
  , http = require('http')
  , express = require('express')
  , port = process.env.PORT || 2657
  , app = express();

var server = http.createServer(app)
  , gameServer = new colyseus.Server({server: server})

gameServer.register(ChatRoom)
gameServer.register(BattleRoom)

app.use(express.static(__dirname));
server.listen(port);

console.log(`Listening on http://localhost:${ port }`)
