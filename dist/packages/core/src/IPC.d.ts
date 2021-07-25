import { Presence } from './presence/Presence';
export declare function requestFromIPC<T>(presence: Presence, publishToChannel: string, method: string, args: any[], rejectionTimeout?: number): Promise<T>;
export declare function subscribeIPC(presence: Presence, processId: string, channel: string, replyCallback: (method: string, args: any[]) => any): Promise<void>;
