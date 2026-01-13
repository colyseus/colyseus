/**
 * Room.ts augmentations
 * Monkey-patches some Room methods to improve the testing experience.
 */

import { Deferred, Room, type Client } from "@colyseus/core";
import { Room as ClientRoom } from "@colyseus/sdk";

// import timers from "timers/promises";

// ----------------------------------------------------------------------------------------
// SERVER-SIDE EXTENSIONS
// ----------------------------------------------------------------------------------------

declare module "@colyseus/core" {
  interface Room {
    waitForMessage(messageType: string): Promise<[Client, any]>;
    waitForNextMessage(additionalDelay?: number): Promise<void>;
    waitForNextPatch(): Promise<void>;
    waitForNextSimulationTick(): Promise<void>;
    _waitingForMessage: [number, Deferred];
    _waitingForPatch: [number, Deferred];
  }
}

/*
 * Wait until receive message
 */
const _originalOnMessage = Room.prototype['_onMessage'];
Room.prototype['_onMessage'] = function(this: Room) {
  _originalOnMessage.apply(this, arguments as any);
  if (this._waitingForMessage) {
    setTimeout(() => this._waitingForMessage[1].resolve(), this._waitingForMessage[0]);
  }
};
Room.prototype.waitForNextMessage = async function(this: Room, additionalDelay: number = 0) {
  this._waitingForMessage = [additionalDelay, new Deferred()];
  return this._waitingForMessage[1];
}

Room.prototype.waitForMessage = async function(this: Room, type: string, rejectTimeout: number = 3000) {
  const originalHandlers = this['onMessageEvents'].events[type] || [];
  const room = this;

  return new Promise<[Client, any]>((resolve, reject) => {
    const rejectionTimeout = setTimeout(() => reject(new Error(`message '${type}' was not called. timed out (${rejectTimeout}ms)`)), rejectTimeout);

    // Replace handlers with our interceptor
    room['onMessageEvents'].events[type] = [
      async function (client: Client, message: any) {
        // clear rejection timeout
        clearTimeout(rejectionTimeout);

        // call original handlers
        for (const handler of originalHandlers) {
          await handler.call(room, client, message);
        }

        // revert to original handlers
        room['onMessageEvents'].events[type] = originalHandlers;

        // resolves waitForMessage promise.
        resolve([client, message]);
      }
    ];
  });
}

/**
 * Wait next simulation tick
 */
Room.prototype.waitForNextSimulationTick = async function(this: Room) {
  if (this['_simulationInterval']) {
    const milliseconds = this['_simulationInterval']['_idleTimeout'];
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    // return timers.setTimeout(milliseconds);

  } else {
    console.warn("⚠️ waitForSimulation() - .setSimulationInterval() is a must.");
    return Promise.resolve();
  }
}

/**
 * Wait for next patch
 */
const _originalBroadcastPatch = Room.prototype['broadcastPatch'];
Room.prototype['broadcastPatch'] = function(this: Room) {
  const retVal = _originalBroadcastPatch.call(this);
  if (this._waitingForPatch) {
    setTimeout(() => this._waitingForPatch[1].resolve(), this._waitingForPatch[0]);
  }
  return retVal;
};
Room.prototype.waitForNextPatch = async function (this: Room, additionalDelay: number = 0) {
  this._waitingForPatch = [additionalDelay, new Deferred()];
  return this._waitingForPatch[1];
}

// ----------------------------------------------------------------------------------------
// CLIENT-SIDE EXTENSIONS
// ----------------------------------------------------------------------------------------

declare module "@colyseus/sdk" {
  interface Room {
    waitForMessage(messageType: string, rejectTimeout?: number): Promise<any>;
    waitForNextMessage(additionalDelay?: number): Promise<[string, any]>;
    waitForNextPatch(): Promise<void>;
    _waitingForMessage: [number, Deferred];
    _waitingForPatch: [number, Deferred];
  }
}

ClientRoom.prototype.waitForMessage = async function(this: Room, type: string, rejectTimeout: number = 3000) {
  return new Promise((resolve, reject) => {
    const received = (message) => {
      unbind();
      resolve(message);
      clearTimeout(rejectionTimeout);
    }
    const unbind = this['onMessageHandlers'].on(type, (message) => received(message));

    const rejectionTimeout = setTimeout(() => {
      unbind();
      reject(new Error(`message '${type}' was not called. timed out (${rejectTimeout}ms)`));
    }, rejectTimeout);
  });
}

const _originalClientOnMessage = ClientRoom.prototype['dispatchMessage'];
ClientRoom.prototype['dispatchMessage'] = function(this: ClientRoom) {
  _originalClientOnMessage.apply(this, arguments as any);
  if (this._waitingForMessage) {
    setTimeout(() => {
      this._waitingForMessage[1].resolve([arguments[0], arguments[1]]);
    }, this._waitingForMessage[0]);
  }
};
ClientRoom.prototype.waitForNextMessage = async function(this: Room, additionalDelay: number = 0) {
  this._waitingForMessage = [additionalDelay, new Deferred()];
  return this._waitingForMessage[1];
}

const _originalClientPatch = ClientRoom.prototype['patch'];
ClientRoom.prototype['patch'] = function(this: ClientRoom) {
  _originalClientPatch.apply(this, arguments);
  if (this._waitingForPatch) {
    setTimeout(() => {
      this._waitingForPatch[1].resolve([arguments[0], arguments[1]]);
    }, this._waitingForPatch[0]);
  }
};
ClientRoom.prototype.waitForNextPatch = async function(this: ClientRoom, additionalDelay: number = 0) {
  this._waitingForPatch = [additionalDelay, new Deferred()];
  return this._waitingForPatch[1];
}