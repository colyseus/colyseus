"use strict";

import * as assert from "assert";
import * as msgpack from "msgpack-lite";
import { Room } from "../src/Room";
// import { Server } from "../src/Server";
import { Protocol } from "../src/Protocol";
import { createEmptyClient, DummyRoom, Client } from "./utils/mock";

/*
describe('Server', function() {
  var server = new Server({port: 1111});
  var clients: Client[];

  // register dummy room
  server.register('room', DummyRoom);
  server.register('invalid_room', DummyRoom);

  // connect 5 clients into server
  beforeEach(function() {
    clients = [];
    for (var i=0; i<5; i++) {
      var client = createEmptyClient();
      clients.push(client);
      (<any>server).onConnect(client);
    }
  });

  afterEach(function() {
    // disconnect dummy clients
    for (var i = 0, len = clients.length; i < len; i++) {
      clients[ i ].close();
    }
  });

  describe('join request', function() {
    it('should register client listeners when joined a room', function() {
      let client0 = clients[0];
      let client1 = clients[1];

      client0.emit('message', msgpack.encode([ Protocol.JOIN_ROOM, "room", {} ]));
      client1.emit('message', msgpack.encode([ Protocol.JOIN_ROOM, "room", {} ]));

      let lastMessage = client0.lastMessage;
      assert.equal(lastMessage[0], Protocol.JOIN_ROOM);
      assert.equal(lastMessage[1], 0);
      assert.equal(lastMessage[2], "room");

      client0.emit('message', msgpack.encode([ Protocol.LEAVE_ROOM, 0 ]));
      client1.emit('message', msgpack.encode([ Protocol.LEAVE_ROOM, 0 ]));
    });

    it('should join a room with valid options', function() {
      let client = clients[2];
      client.emit('message', msgpack.encode([ Protocol.JOIN_ROOM, "room", {} ]));
      assert.equal( client.lastMessage[0], Protocol.JOIN_ROOM );
      assert.equal( client.lastMessage[1], 1);
      assert.equal( client.lastMessage[2], "room");
    });

    it('shouldn\'t join a room with invalid options', function() {
      let client = clients[3];
      client.emit('message', msgpack.encode([ Protocol.JOIN_ROOM, "invalid_room", { invalid_param: 10 } ]));
      assert.equal(client.lastMessage[0], Protocol.JOIN_ERROR);
    });

  });
});
*/
