import { Deferred, Room } from "@colyseus/core";
import timers from "timers/promises";

declare module "@colyseus/core" {
  interface Room {
    waitForMessage(additionalDelay?: number): Promise<void>;
    waitForSimulation(): Promise<void>;
    waitForPatch(): Promise<void>;
    _waitingForMessage: [number, Deferred];
  }
}

// cache original _onMessage implementation
const _originalOnMessage = Room.prototype['_onMessage'];
Room.prototype['_onMessage'] = function(this: Room) {
  _originalOnMessage.apply(this, arguments);

  if (this._waitingForMessage) {
    setTimeout(() =>
      this._waitingForMessage[1].resolve(), this._waitingForMessage[0]);
  }
};

Room.prototype.waitForMessage = async function(this: Room, additionalDelay: number = 10) {
  this._waitingForMessage = [additionalDelay, new Deferred()];
  return this._waitingForMessage[1];
}

Room.prototype.waitForSimulation = async function(this: Room) {
  if (this['_simulationInterval']) {
    const milliseconds = this['_simulationInterval']['_idleTimeout'];
    return timers.setTimeout(milliseconds);

  } else {
    console.warn("⚠️ waitForSimulation() - .setSimulationInterval() is a must.");
    return Promise.resolve();
  }
}

Room.prototype.waitForPatch = async function(this: Room) {
  if (this['_patchInterval']) {
    const milliseconds = this['_patchInterval']['_idleTimeout'];
    return timers.setTimeout(milliseconds);

  } else {
    console.warn("⚠️ waitForPatch() - .setSimulationInterval() is a must.");
    return Promise.resolve();
  }
}