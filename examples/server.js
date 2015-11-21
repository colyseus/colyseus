var colyseus = require('../index')
  , ChatRoom = require('./rooms/chat_room')
  , http = require('http')
  , express = require('express')
  , port = process.env.PORT || 2657
  , app = express();

var server = http.createServer(app)
  , gameServer = new colyseus.Server({server: server})

gameServer.room(ChatRoom)

app.use(express.static(__dirname));
server.listen(port);

console.log(`Listening on http://localhost:${ port }`)
