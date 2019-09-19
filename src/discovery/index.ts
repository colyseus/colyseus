import ip from 'internal-ip';
import { Presence } from '../presence/Presence';

const NODES_SET = 'colyseus:nodes';
const DISCOVERY_CHANNEL = 'colyseus:nodes:discovery';

export interface Node {
    port: number;
    processId: string;
}

async function getNodeAddress(node: Node) {
  const ipv4 = await ip.v4();
  return `${node.processId}/${ipv4}:${node.port}`;
}

export async function registerNode(presence: Presence, node: Node) {
  const nodeAddress = await getNodeAddress(node);
  presence.sadd(NODES_SET, nodeAddress);
  presence.publish(DISCOVERY_CHANNEL, `add,${nodeAddress}`);
}

export async function unregisterNode(presence: Presence, node: Node) {
  const nodeAddress = await getNodeAddress(node);
  presence.srem(NODES_SET, nodeAddress);
  presence.publish(DISCOVERY_CHANNEL, `remove,${nodeAddress}`);
}
