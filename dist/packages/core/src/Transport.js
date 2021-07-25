"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientState = exports.Transport = void 0;
class Transport {
}
exports.Transport = Transport;
var ClientState;
(function (ClientState) {
    ClientState[ClientState["JOINING"] = 0] = "JOINING";
    ClientState[ClientState["JOINED"] = 1] = "JOINED";
    ClientState[ClientState["RECONNECTED"] = 2] = "RECONNECTED";
    ClientState[ClientState["LEAVING"] = 3] = "LEAVING";
})(ClientState = exports.ClientState || (exports.ClientState = {}));
//# sourceMappingURL=Transport.js.map