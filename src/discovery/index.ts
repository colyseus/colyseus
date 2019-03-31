import net from 'net';
import { Presence } from '../presence/Presence';

const NODES_SET = 'colyseus:nodes';
const DISCOVERY_CHANNEL = 'colyseus:nodes:discovery';

export interface Node {
    processId: string;
    addressInfo: net.AddressInfo;
}

function getNodeAddress(node: Node) {
    const address = (node.addressInfo.address === '::') ? `[${node.addressInfo.address}]` : node.addressInfo.address;
    return `${node.processId}/${address}:${node.addressInfo.port}`;
}

export function registerNode(presence: Presence, node: Node) {
    const nodeAddress = getNodeAddress(node);
    presence.sadd(NODES_SET, nodeAddress);
    presence.publish(DISCOVERY_CHANNEL, `add,${nodeAddress}`);
}

export function unregisterNode(presence: Presence, node: Node) {
    const nodeAddress = getNodeAddress(node);
    presence.srem(NODES_SET, nodeAddress);
    presence.publish(DISCOVERY_CHANNEL, `remove,${nodeAddress}`);
}
