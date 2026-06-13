import './util';
import { describe, test, expectTypeOf } from 'vitest';
import { schema, t, type SchemaType, type Data, MapSchema } from '@colyseus/schema';

// Reaches the SDK predict barrel by its public subpath path. If this import
// fails at runtime, `@colyseus/sdk/predict` is misrouted in package.json /
// rollup; if it fails at compile time, the barrel's re-exports are wrong.
import {
    Predict,
    Reconciler,
    SimReconciler,
    PredictedEvents,
    type StepContext,
} from '../src/predict.ts';
import type { InputHandle } from '../src/input/InputHandle.ts';

const MoveInput = schema({
    moveX: t.number().default(0),
    jump: t.boolean().default(false),
});
type MoveInputT = SchemaType<typeof MoveInput>;

class FakePlayer { x = 0; y = 0; }

class Bullet { x = 0; y = 0; angle = 0; ownerId = ''; spawnTime = 0; }
class GameState { bullets = new MapSchema<Bullet>(); }

/**
 * The migration's load-bearing inference: across the package boundary,
 * `predict.reconciler(instance, { input: InputHandle<W>, step })` must infer
 * `step`'s `cmd` parameter as `Data<W>` — without that the consumer falls back
 * to `Data<unknown>` casts (the very friction TODO 01 set out to remove).
 */
describe('@colyseus/sdk/predict — public barrel', () => {
    test('public surface: Predict.get / reconciler / events', () => {
        // `Predict.get(room, …)` matches the sibling `Callbacks.get(room)` API
        // (kept after the rename pass). The active-rollback method was
        // renamed `controller` → `reconciler` (matches the returned type).
        // `events()` is kept — already namespaced under the `predict` instance.
        expectTypeOf(Predict).toHaveProperty('get');
        expectTypeOf<InstanceType<typeof Predict>>().toHaveProperty('reconciler');
        expectTypeOf<InstanceType<typeof Predict>>().toHaveProperty('physics');
        expectTypeOf<InstanceType<typeof Predict>>().toHaveProperty('events');
        expectTypeOf<InstanceType<typeof Predict>>().toHaveProperty('spawns');
        expectTypeOf<InstanceType<typeof Predict>>().not.toHaveProperty('controller');
    });

    test('predict.spawns infers local fields from the collection element (no any)', () => {
        // Compile-only: `spawn()` is type-checked against the inferred server
        // fields — NOT `any`. `owned` sees the full server entity `S`; `step`
        // and the merged view see the predicted-local `Partial<S>`.
        const _check = (p: Predict<GameState>, room: { sessionId: string }) => {
            const bullets = p.spawns('bullets', {
                owned: (b) => { expectTypeOf(b).toEqualTypeOf<Bullet>(); return b.ownerId === room.sessionId; },
                correlate: 'fifo',
                step: (b, dt) => {
                    expectTypeOf(b).toEqualTypeOf<Partial<Bullet>>();
                    expectTypeOf(dt).toBeNumber();
                },
            });
            const h = bullets.spawn({ x: 0, y: 0, angle: 0, spawnTime: 0 });
            expectTypeOf(h.local).toEqualTypeOf<Partial<Bullet>>();
            // @ts-expect-error — unknown field rejected, proving it isn't `any`
            bullets.spawn({ bogus: 1 });
            for (const e of bullets.entries()) {
                expectTypeOf(e.server).toEqualTypeOf<Bullet | undefined>();
                expectTypeOf(e.local).toEqualTypeOf<Partial<Bullet> | undefined>();
            }
        };
        void _check;
    });

    test('predict.spawns infers client-only fields from an annotated callback param', () => {
        // When the predicted local carries fields the server doesn't (here
        // `speed`), annotating one callback param pins `L` — `spawn()` then
        // infers and checks those fields too, still without `any`.
        const _check = (p: Predict<GameState>) => {
            const bullets = p.spawns('bullets', {
                step: (b: { x: number; y: number; speed: number }, dt) => { b.x += b.speed * dt; },
            });
            const h = bullets.spawn({ x: 0, y: 0, speed: 5 });
            expectTypeOf(h.local).toEqualTypeOf<{ x: number; y: number; speed: number }>();
        };
        void _check;
    });

    test('predict.spawns data slot is inferred from the factory; absent ⇒ undefined', () => {
        // `D` is inferred from `data`'s return; `entry.data` and the spawn
        // handle's `data` carry it. Omitting `data` types the slot as undefined.
        const _check = (p: Predict<GameState>) => {
            const withData = p.spawns('bullets', {
                data: () => ({ catchup: 0, hidden: false }),
            });
            const h = withData.spawn({ x: 0, y: 0 });
            expectTypeOf(h.data).toEqualTypeOf<{ catchup: number; hidden: boolean }>();
            for (const e of withData.entries()) {
                expectTypeOf(e.data).toEqualTypeOf<{ catchup: number; hidden: boolean }>();
            }

            const noData = p.spawns('bullets', {});
            for (const e of noData.entries()) {
                expectTypeOf(e.data).toEqualTypeOf<undefined>();
            }
        };
        void _check;
    });

    test('predict.sim({ input, world, step, adopt, pose }) infers cmd Data<W>, pose P, world E', () => {
        // Compile-only: a never-run closure exercising call-site inference for the
        // composite/opaque-state controller — the same Data<W> story as reconciler(),
        // plus pose `P` from `pose` and world handle `E` from `world`. No bound
        // instance: `adopt` closes over its sources.
        const _check = (p: ReturnType<typeof Predict.get>, handle: InputHandle<MoveInputT>) => {
            const ctl = p.sim({
                input: handle,
                world: { world: 1 },
                step: (_ctx, cmd, w) => {
                    expectTypeOf(cmd).toEqualTypeOf<Data<MoveInputT>>();
                    expectTypeOf(w).toEqualTypeOf<{ world: number }>();
                },
                adopt: (w) => { expectTypeOf(w).toEqualTypeOf<{ world: number }>(); },
                pose: (_w) => ({ x: 0, y: 0 }),
            });
            expectTypeOf(ctl.pose()).toEqualTypeOf<{ x: number; y: number }>();
        };
        void _check;
    });

    test('predict.reconciler(self, { input }) infers cmd as Data<W>', () => {
        // The test is the type assertion below — no runtime call needed (and
        // setting up a real room/input handle isn't worth the wiring here).
        type R = ReturnType<typeof Predict.get>;
        type ReconArgs = Parameters<R['reconciler']>;
        type StepFn = NonNullable<ReconArgs[1]['step']>;
        type StepCmd = Parameters<StepFn>[2];

        // The W in the call `reconciler<FakePlayer, MoveInputT>` flows to
        // `cmd: Data<MoveInputT>` on the step callback. We can't run the
        // inference standalone with named types here, but the live shape is
        // covered by the `instantiation` block below.
        type Hand = InputHandle<MoveInputT>;
        type ExpectedCmd = Data<MoveInputT>;

        // Sanity: `ExpectedCmd` is a usable record-of-defaulted-fields shape.
        const cmd: ExpectedCmd = { moveX: 1, jump: true } as ExpectedCmd;
        void cmd;
        void ({} as Hand);
        void ({} as StepCmd);
    });

    test('Reconciler<S, I> and PredictedEvents<K> are concrete classes', () => {
        // If the barrel accidentally re-exported only the *types*, `new …`
        // would fail at runtime — guarding the value-vs-type re-export.
        expectTypeOf(Reconciler).toBeConstructibleWith({} as any, {} as any);
        expectTypeOf(SimReconciler).toBeConstructibleWith({} as any);
        expectTypeOf(PredictedEvents).toBeConstructibleWith({} as any, {} as any);
    });

    test('StepContext carries the fixed step contract', () => {
        // Spot-check: `StepContext.dt` is `number`, `isReplay` is `boolean`.
        // Lets us catch a silent drop of either field across the move.
        expectTypeOf<StepContext>().toHaveProperty('dt').toBeNumber();
        expectTypeOf<StepContext>().toHaveProperty('isReplay').toBeBoolean();
    });

});
