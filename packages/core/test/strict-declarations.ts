import {
  type Client,
  Room,
  room,
  type RoomOptions,
} from '@colyseus/core';
import {
  OnCreateException,
  OnDropException,
  OnJoinException,
  OnLeaveException,
  OnReconnectException,
} from '@colyseus/core/errors/RoomExceptions';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

interface StrictRoomOptions extends RoomOptions {
  state: { count: number };
  client: Client;
}

class StrictRoom extends Room<StrictRoomOptions> {
  override onCreate(options: { seed: string }) {}
  override onJoin(client: Client, options?: { name: string }, auth?: { id: string }) {}
  override onLeave(client: Client, code?: 4000 | 4001) {}
  override onDrop(client: Client, code?: 4002 | 4003) {}
  override onReconnect(client: Client) {}
}

type HookInference = [
  Expect<Equal<OnCreateException<StrictRoom>['options'], { seed: string }>>,
  Expect<Equal<OnJoinException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnJoinException<StrictRoom>['options'], { name: string } | undefined>>,
  Expect<Equal<OnJoinException<StrictRoom>['auth'], { id: string } | undefined>>,
  Expect<Equal<OnLeaveException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnLeaveException<StrictRoom>['consented'], 4000 | 4001 | undefined>>,
  Expect<Equal<OnDropException<StrictRoom>['client'], Client>>,
  Expect<Equal<OnDropException<StrictRoom>['code'], 4002 | 4003 | undefined>>,
  Expect<Equal<OnReconnectException<StrictRoom>['client'], Client>>,
];

const FunctionalRoom = room<StrictRoomOptions>({
  state: () => ({ count: 0 }),
  onCreate(options: { seed: string }) {
    this.state.count = options.seed.length;
  },
});
const functionalRoom: Room<StrictRoomOptions> = new FunctionalRoom();

void (0 as unknown as HookInference);
void functionalRoom;
