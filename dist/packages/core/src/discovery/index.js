"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unregisterNode = exports.registerNode = void 0;
const internal_ip_1 = __importDefault(require("internal-ip"));
const NODES_SET = 'colyseus:nodes';
const DISCOVERY_CHANNEL = 'colyseus:nodes:discovery';
async function getNodeAddress(node) {
    const host = process.env.SELF_HOSTNAME || await internal_ip_1.default.v4();
    const port = process.env.SELF_PORT || node.port;
    return `${node.processId}/${host}:${port}`;
}
async function registerNode(presence, node) {
    const nodeAddress = await getNodeAddress(node);
    await presence.sadd(NODES_SET, nodeAddress);
    await presence.publish(DISCOVERY_CHANNEL, `add,${nodeAddress}`);
}
exports.registerNode = registerNode;
async function unregisterNode(presence, node) {
    const nodeAddress = await getNodeAddress(node);
    await presence.srem(NODES_SET, nodeAddress);
    await presence.publish(DISCOVERY_CHANNEL, `remove,${nodeAddress}`);
}
exports.unregisterNode = unregisterNode;
//# sourceMappingURL=index.js.map