import type { Room } from '../Room';
import { RoomListingData } from './driver/interfaces';
export declare function updateLobby(room: Room, removed?: boolean): void;
export declare function subscribeLobby(callback: (roomId: string, roomListing: RoomListingData) => void): Promise<() => any>;
