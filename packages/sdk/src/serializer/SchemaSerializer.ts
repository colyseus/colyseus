import { Schema, Decoder, Reflection, Iterator, getDecoderStateCallbacks } from "@colyseus/schema";
import type { Serializer } from "./Serializer.ts";
import type { Room } from "../Room.ts";

export type SchemaConstructor<T = Schema> = new (...args: any[]) => T;

//
// TODO: use a schema interface, which even having duplicate definitions, it could be used to get the callback proxy.
//
// ```ts
//     export type SchemaCallbackProxy<RoomState> = (<T extends ISchema>(instance: T) => CallbackProxy<T>);
//     export function getStateCallbacks<T extends ISchema>(room: Room<T>) {
// ```
//
export function getStateCallbacks<T>(room: Room<any, T>) {
    try {
        // SchemaSerializer
        // @ts-ignore
        return getDecoderStateCallbacks<T>((room['serializer'] as unknown as SchemaSerializer<T>).decoder);
    } catch (e) {
        // NoneSerializer
        return undefined;
    }
}

export class SchemaSerializer<T extends Schema = any> implements Serializer<T> {
    state: T;
    decoder: Decoder<T>;

    setState(encodedState: Uint8Array, it?: Iterator) {
        this.decoder.decode(encodedState, it);
    }

    getState() {
        return this.state;
    }

    patch(patches: Uint8Array, it?: Iterator) {
        return this.decoder.decode(patches, it);
    }

    teardown() {
        this.decoder.root.clearRefs();
    }

    handshake(bytes: Uint8Array, it?: Iterator) {
        if (this.state) {
            //
            // TODO: validate definitions against concreate this.state instance
            //
            Reflection.decode(bytes, it); // no-op

            this.decoder = new Decoder(this.state);

        } else {
            // initialize reflected state from server
            this.decoder = Reflection.decode(bytes, it);
            this.state = this.decoder.state;
        }
    }
}
