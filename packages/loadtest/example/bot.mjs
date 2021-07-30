export function requestJoinOptions (i) {
    return { requestNumber: i };
}

export function onJoin () {
    console.info(this.sessionId, "joined.");

    this.onMessage("*", (type, message) => {
        console.log("onMessage:", type, message);
    });
}

export function onLeave () {
    console.info(this.sessionId, "left.");
}

export function onError (err) {
    console.info(this.sessionId, "!! ERROR !!", err.message);
}

export function onStateChange (state) {
    // console.info(this.sessionId, "new state:", state);
}