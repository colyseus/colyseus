var colyseus = require('../index')
  , http = require('http')
  , express = require('express')
  , port = process.env.PORT || 2657
  , app = express();

var server = http.createServer(app)
  , gameServer = new colyseus.Server({server: server})

var ChatRoom = require('./rooms/chat_room')

gameServer.register("chat", ChatRoom)
// gameServer.register("another_chat_room", ChatRoom, { map: "data1.json" })

app.use(express.static(__dirname));
server.listen(port);

console.log(`Listening on http://localhost:${ port }`)
