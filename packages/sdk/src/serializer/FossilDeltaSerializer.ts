/*

// Dependencies:
// "@gamestdio/state-listener": "^3.1.0",
// "fossil-delta": "^1.0.0",

import { Serializer } from "./Serializer";

import { StateContainer } from '@gamestdio/state-listener';
import * as fossilDelta from 'fossil-delta';
import * as msgpack from '../msgpack';

export class FossilDeltaSerializer<State= any> implements Serializer<State> {
    api: StateContainer<State> = new StateContainer<State>({} as State);
    protected previousState: any;

    getState(): State {
        return this.api.state;
    }

    setState(encodedState: any): void {
        this.previousState = new Uint8Array(encodedState);
        this.api.set(msgpack.decode(this.previousState));
    }

    patch(binaryPatch) {
        // apply patch
        this.previousState = new Uint8Array(fossilDelta.apply(this.previousState, binaryPatch));

        // trigger update callbacks
        this.api.set(msgpack.decode(this.previousState));
    }

    teardown() {
        this.api.removeAllListeners();
    }
}

*/