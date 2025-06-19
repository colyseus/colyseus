import { Serializer } from "./Serializer";

export class NoneSerializer<T = any> implements Serializer<T> {
    setState(rawState: any): void {}
    getState() { return null; }
    patch(patches) {}
    teardown() { }
    handshake(bytes: number[]) {}
}
