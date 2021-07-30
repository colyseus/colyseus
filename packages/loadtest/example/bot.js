exports.requestJoinOptions = function (i) {
    return { requestNumber: i };
}

exports.onJoin = function () {
    console.info(this.sessionId, "joined.");

    this.onMessage("*", (type, message) => {
        console.log("onMessage:", type, message);
    });
}

exports.onLeave = function () {
    console.info(this.sessionId, "left.");
}

exports.onError = function (err) {
    console.info(this.sessionId, "!! ERROR !!", err.message);
}

exports.onStateChange = function (state) {
    // console.info(this.sessionId, "new state:", state);
}
