import { Room, Client } from "colyseus.js";

export function requestJoinOptions (this: Client, i: number) {
    return { requestNumber: i };
}

export function onJoin(this: Room) {
    console.log(this.sessionId, "joined.");

    this.onMessage("*", (type, message) => {
        console.log("onMessage:", type, message);
    });
}

export function onLeave(this: Room) {
    console.log(this.sessionId, "left.");
}

export function onError(this: Room, err) {
    console.error(this.sessionId, "!! ERROR !!", err.message);
}

export function onStateChange(this: Room, state) {
    // console.log(this.sessionId, "new state:", state);
}
