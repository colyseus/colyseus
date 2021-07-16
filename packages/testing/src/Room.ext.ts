/**
 * Room.ts augmentations
 * Monkey-patches some Room methods to improve the testing experience.
 */

import { Deferred, Room } from "@colyseus/core";
import timers from "timers/promises";

declare module "@colyseus/core" {
  interface Room {
    waitForNextMessage(additionalDelay?: number): Promise<void>;
    waitForNextPatch(): Promise<void>;
    waitForNextSimulationTick(): Promise<void>;
    _waitingForMessage: [number, Deferred];
    _waitingForPatch: [number, Deferred];
  }
}

declare module "colyseus.js" {
  interface Room {
    room: any;
  }
}

/*
 * Wait until receive message
 */
const _originalOnMessage = Room.prototype['_onMessage'];
Room.prototype['_onMessage'] = function(this: Room) {
  _originalOnMessage.apply(this, arguments);
  if (this._waitingForMessage) {
    setTimeout(() => this._waitingForMessage[1].resolve(), this._waitingForMessage[0]);
  }
};
Room.prototype.waitForNextMessage = async function(this: Room, additionalDelay: number = 10) {
  this._waitingForMessage = [additionalDelay, new Deferred()];
  return this._waitingForMessage[1];
}

/**
 * Wait next simulation tick
 */
Room.prototype.waitForNextSimulationTick = async function(this: Room) {
  if (this['_simulationInterval']) {
    const milliseconds = this['_simulationInterval']['_idleTimeout'];
    return timers.setTimeout(milliseconds);

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
  const retVal = _originalBroadcastPatch.apply(this, arguments);
  if (this._waitingForPatch) {
    setTimeout(() => this._waitingForPatch[1].resolve(), this._waitingForPatch[0]);
  }
  return retVal;
};
Room.prototype.waitForNextPatch = async function (this: Room, additionalDelay: number = 0) {
  this._waitingForPatch = [additionalDelay, new Deferred()];
  return this._waitingForPatch[1];
}