import { Presence } from '../presence/Presence';

const NODES_SET = 'colyseus:nodes';
const DISCOVERY_CHANNEL = 'colyseus:nodes:discovery';
import ip from 'public-ip';

export interface Node {
    port: number;
    processId: string;
}

function getNodeAddress(node: Node, cb: (nodeAddress: string) => any) {
    ip.v4().then((publicAddress: string) => {
        return cb(node.processId + '/' + publicAddress + ':' + node.port);
    });
}

export function registerNode(presence: Presence, node: Node) {
    getNodeAddress(node, (nodeAddress: string) => {
        presence.sadd(NODES_SET, nodeAddress);
        presence.publish(DISCOVERY_CHANNEL, `add,${nodeAddress}`);
    });
}

export function unregisterNode(presence: Presence, node: Node) {
    getNodeAddress(node, (nodeAddress: string) => {
        presence.srem(NODES_SET, nodeAddress);
        presence.publish(DISCOVERY_CHANNEL, `remove,${nodeAddress}`);
    });
}
