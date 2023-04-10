import ip from 'internal-ip';
import { Presence } from '../presence/Presence';

const NODES_SET = 'colyseus:nodes';
const DISCOVERY_CHANNEL = 'colyseus:nodes:discovery';

export interface Node {
  port: number;
  processId: string;
}

async function getNodeAddress(node: Node) {
  const host = process.env.SELF_HOSTNAME || await ip.v4();
  const port = process.env.SELF_PORT ?? node.port;
  const baseAddress = `${node.processId}/${host}`
  const shouldPortBeAddedToAddress: boolean = !!port;
  return shouldPortBeAddedToAddress ? `${baseAddress}:${port}` : baseAddress;
}

export async function registerNode(presence: Presence, node: Node) {
  const nodeAddress = await getNodeAddress(node);
  await presence.sadd(NODES_SET, nodeAddress);
  await presence.publish(DISCOVERY_CHANNEL, `add,${nodeAddress}`);
}

export async function unregisterNode(presence: Presence, node: Node) {
  const nodeAddress = await getNodeAddress(node);
  await presence.srem(NODES_SET, nodeAddress);
  await presence.publish(DISCOVERY_CHANNEL, `remove,${nodeAddress}`);
}
