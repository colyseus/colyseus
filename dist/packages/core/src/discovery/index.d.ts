import { Presence } from '../presence/Presence';
export interface Node {
    port: number;
    processId: string;
}
export declare function registerNode(presence: Presence, node: Node): Promise<void>;
export declare function unregisterNode(presence: Presence, node: Node): Promise<void>;
