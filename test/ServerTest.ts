"use strict";

import * as assert from "assert";
import * as msgpack from "msgpack-lite";
import { Room } from "../src/Room";
import { Server } from "../src/Server";
import { Protocol } from "../src/Protocol";
import { createEmptyClient, DummyRoom } from "./utils/mock";

describe('Server', function() {
  var server = new Server({port: 1111});
  var clients = [];

  // register dummy room
  server.register('room', DummyRoom);
  server.register('invalid_room', DummyRoom);

  // connect 5 clients into server
  before(function() {
    for (var i=0; i<5; i++) {
      var client = createEmptyClient();
      clients.push(client);
      (<any>server).onConnect(client);
    }
  });

  after(function() {
    // disconnect dummy clients
    for (var id in clients) {
      clients[ id ].close();
    }
  });

  describe('join request', function() {
    it('should join a room with valid options', function() {
      let client = clients[0];

      assert.doesNotThrow(function() {
        (<any>server).onJoinRoomRequest(client, 'room', {});
      });

      assert.equal( 2, client.messages.length );
      assert.equal( Protocol.USER_ID, msgpack.decode(client.messages[0])[0] );
      assert.equal( Protocol.JOIN_ROOM, msgpack.decode(client.messages[1])[0] );
    });

    it('shouldn\'t join a room with invalid options', function() {
      let client = clients[1];

      assert.throws(function() {
        (<any>server).onJoinRoomRequest(client, 'invalid_room', { invalid_param: 10 });
      }, /join_request_fail/);

      assert.equal( 1, client.messages.length );
      assert.equal( Protocol.USER_ID, msgpack.decode(client.messages[0])[0] );

    });
  });
});
