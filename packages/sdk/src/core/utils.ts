import type { SDKTypes, Room as ServerRoom } from '@colyseus/core';

export function now(): number {
    return typeof(performance) !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Infer the room constructor from ServerType based on the instance type.
 * This allows proper type inference for SDK Room methods like `send()` and `onMessage()`.
 */
export type InferRoomConstructor<ServerType extends SDKTypes, Instance> =
  // First, try to find a matching room constructor in ServerType['~rooms']
  ServerType extends SDKTypes<infer Rooms>
    ? {
        [K in keyof Rooms]: Instance extends InstanceType<Rooms[K]['~room']>
          ? Rooms[K]['~room']
          : never
      }[keyof Rooms]
    : // Fallback: create a synthetic constructor type from the instance
      (typeof ServerRoom) & { prototype: Instance };