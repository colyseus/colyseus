var assert = require('assert')
  , MatchMaker = require('../lib/match_maker')
  , DummyRoom = require('./dummy_room')
  , Room = require('../lib/room')
  , mock = require('./mock')

describe('MatchMaker', function() {
  var matchMaker;

  before(function() {
    matchMaker = new MatchMaker()
    matchMaker.addHandler('room', Room)
    matchMaker.addHandler('dummy_room', DummyRoom)
  });

  describe('room handlers', function() {
    it('should add handler with name', function() {
      assert.equal(Room, matchMaker.handlers.room[0]);
      assert.equal(0, Object.keys(matchMaker.handlers.room[1]).length);
      assert.equal(false, matchMaker.hasAvailableRoom('room'));
    });

    it('should create a new room on joinOrCreateByName', function() {
      var client = mock.createDummyClient()
      var room = matchMaker.joinOrCreateByName(client, 'room', {})

      assert.equal(0, room.roomId)
      assert.equal(1, room.clients.length)
      assert.equal(1, Object.keys(matchMaker.roomsById).length)
    })

    it('should throw error when trying to join room by id with invalid id', function() {
      var client = mock.createDummyClient()
      assert.throws(() => {
        matchMaker.joinById(client, 100)
      }, Error);
    })

    it('should throw error when trying to join room with invalid params', function() {
      var client = mock.createDummyClient()
      assert.throws(() => {
        matchMaker.joinOrCreateByName(client, 'dummy_room', {invalid_param: 10})
      }, Error);
    })

    it('should join existing room on joinById', function() {
      assert.equal(false, matchMaker.hasAvailableRoom('dummy_room'))

      var client1 = mock.createDummyClient()
      var client2 = mock.createDummyClient()

      var room = matchMaker.joinOrCreateByName(client1, 'dummy_room', {})
      var joiningRoom = matchMaker.joinById(client2, room.roomId, {})

      assert.equal(true, matchMaker.hasAvailableRoom('dummy_room'))
      assert.equal('dummy_room', room.roomName)
      assert.equal(room.roomId, joiningRoom.roomId)
      assert.equal(2, joiningRoom.clients.length)
    })
  });
});

