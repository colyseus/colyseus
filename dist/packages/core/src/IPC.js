"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeIPC = exports.requestFromIPC = void 0;
const Debug_1 = require("./Debug");
const Protocol_1 = require("./Protocol");
const Utils_1 = require("./Utils");
async function requestFromIPC(presence, publishToChannel, method, args, rejectionTimeout = Utils_1.REMOTE_ROOM_SHORT_TIMEOUT) {
    return new Promise((resolve, reject) => {
        let unsubscribeTimeout;
        const requestId = Utils_1.generateId();
        const channel = `ipc:${requestId}`;
        const unsubscribe = () => {
            presence.unsubscribe(channel);
            clearTimeout(unsubscribeTimeout);
        };
        presence.subscribe(channel, (message) => {
            const [code, data] = message;
            if (code === Protocol_1.IpcProtocol.SUCCESS) {
                resolve(data);
            }
            else if (code === Protocol_1.IpcProtocol.ERROR) {
                reject(data);
            }
            unsubscribe();
        });
        presence.publish(publishToChannel, [method, requestId, args]);
        unsubscribeTimeout = setTimeout(() => {
            unsubscribe();
            reject(`IPC timed out. method: ${method}, args: ${JSON.stringify(args)}`);
        }, rejectionTimeout);
    });
}
exports.requestFromIPC = requestFromIPC;
async function subscribeIPC(presence, processId, channel, replyCallback) {
    await presence.subscribe(channel, (message) => {
        const [method, requestId, args] = message;
        const reply = (code, data) => {
            presence.publish(`ipc:${requestId}`, [code, data]);
        };
        // reply with method result
        let response;
        try {
            response = replyCallback(method, args);
        }
        catch (e) {
            Debug_1.debugAndPrintError(e);
            return reply(Protocol_1.IpcProtocol.ERROR, e.message || e);
        }
        if (!(response instanceof Promise)) {
            return reply(Protocol_1.IpcProtocol.SUCCESS, response);
        }
        response.
            then((result) => reply(Protocol_1.IpcProtocol.SUCCESS, result)).
            catch((e) => {
            // user might have called `reject()` without arguments.
            const err = e && e.message || e;
            reply(Protocol_1.IpcProtocol.ERROR, err);
        });
    });
}
exports.subscribeIPC = subscribeIPC;
//# sourceMappingURL=IPC.js.map