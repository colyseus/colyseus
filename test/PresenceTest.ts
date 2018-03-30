import * as assert from 'assert';
import * as sinon from 'sinon';

import { MatchMaker } from "../src/MatchMaker";
import { DummyRoom, RoomVerifyClient, RoomVerifyClientWithLock, createDummyClient } from './utils/mock';

process.on('unhandledRejection', (reason, promise) => {
  console.log(reason, promise);
});

describe('Presence', function() {
  let matchMaker;

  beforeEach(() => {
    matchMaker = new MatchMaker();

    matchMaker.registerHandler('room', DummyRoom);
    matchMaker.registerHandler('dummy_room', DummyRoom);
    matchMaker.registerHandler('room_with_default_options', DummyRoom, { level: 1 });
    matchMaker.registerHandler('room_verify_client', RoomVerifyClient);
    matchMaker.registerHandler('room_verify_client_with_lock', RoomVerifyClientWithLock);
  });

  describe('reserved seat', () => {
    it('should remove reserved seat after joining the room', async () => {
      const client = createDummyClient({});

      const roomId = await matchMaker.onJoinRoomRequest(client, 'room', {});

      await matchMaker.connectToRoom(client, roomId);

      assert.equal(await matchMaker.presence.hget(roomId, client.sessionId), undefined);
    });
  });


  // describe('verifyClient', () => {
  //   it('should\'t allow to connect when verifyClient returns false', (done) => {
  //     let client = createDummyClient();

  //     RoomVerifyClient.prototype.verifyClient = () => false;

  //     matchMaker.onJoinRoomRequest('room_verify_client', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         throw new Error("this promise shouldn't succeed");

  //       }).catch(err => {
  //         assert.ok(typeof (err) === "string");
  //         assert.equal(client.lastMessage[0], Protocol.JOIN_ERROR);
  //         done();
  //       });
  //     });
  //   });

  //   it('should\'t allow to connect when verifyClient returns a failed promise', (done) => {
  //     let client = createDummyClient();

  //     RoomVerifyClient.prototype.verifyClient = () => new Promise((resolve, reject) => {
  //       setTimeout(() => reject("forbidden"), 50);
  //     });

  //     matchMaker.onJoinRoomRequest('room_verify_client', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         throw new Error("this promise shouldn't succeed");

  //       }).catch(err => {
  //         assert.equal(err, "forbidden");
  //         assert.equal(client.lastMessage[0], Protocol.JOIN_ERROR);
  //         done();
  //       });
  //     });
  //   });

  //   it('should allow to connect when verifyClient returns true', (done) => {
  //     let client = createDummyClient();

  //     RoomVerifyClient.prototype.verifyClient = () => true;

  //     matchMaker.onJoinRoomRequest('room_verify_client', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         assert.ok(room instanceof Room);
  //         done();

  //       }).catch(err => {
  //         throw new Error(err);
  //       });
  //     });
  //   });

  //   it('should allow to connect when verifyClient returns fulfiled promise', (done) => {
  //     let client = createDummyClient();

  //     RoomVerifyClient.prototype.verifyClient = () => new Promise((resolve, reject) => {
  //       setTimeout(() => resolve(), 50);
  //     });

  //     matchMaker.onJoinRoomRequest('room_verify_client', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         assert.equal(1, room.clients.length);
  //         assert.ok(room instanceof Room);
  //         done();

  //       }).catch(err => {
  //         throw new Error(err);
  //       });
  //     });
  //   });

  //   it('should handle leaving room before onJoin is fulfiled.', (done) => {
  //     const onDisposeSpy = sinon.spy(RoomVerifyClient.prototype, 'onDispose');

  //     RoomVerifyClient.prototype.verifyClient = () => new Promise((resolve, reject) => {
  //       setTimeout(() => resolve(), 100);
  //     });

  //     let client = createDummyClient();

  //     matchMaker.onJoinRoomRequest('room_verify_client', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         throw new Error("this promise shouldn't succeed");

  //       }).catch(err => {
  //         assert.equal(0, room.clients.length);
  //         assert.deepEqual({}, matchMaker.sessions);
  //         assert.ok(onDisposeSpy.calledOnce);
  //         onDisposeSpy.restore();

  //         done();
  //       });

  //       client.emit('close');
  //     });
  //   });

  //   xit('shouldn\'t accept second client when room is locked after first one', (done) => {
  //     let client = createDummyClient();

  //     matchMaker.onJoinRoomRequest('room_verify_client_with_lock', { clientId: client.id }, true, (err, room) => {
  //       matchMaker.bindClient(client, room.roomId).then((room) => {
  //         assert.equal(1, room.clients.length);
  //         assert.ok(room instanceof Room);

  //       }).catch(err => {
  //         throw new Error("this promise shouldn't fail");
  //       });
  //     });

  //     // try to join with a second client when the room will be locked
  //     setTimeout(() => {
  //       let client = createDummyClient();
  //       matchMaker.onJoinRoomRequest('room_verify_client_with_lock', { clientId: client.id }, true, (err, room) => {
  //         matchMaker.bindClient(client, room.roomId).then((room) => {
  //           assert.equal(1, room.clients.length);
  //           assert.ok(room instanceof Room);
  //           done();

  //         }).catch(err => {
  //           throw new Error("this promise shouldn't fail");
  //         });
  //       });
  //     }, 10);

  //   });
  // });

});