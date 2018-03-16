import { Client } from './../../test/utils/mock';
import { MatchMaker } from './../MatchMaker';
/**
 * Remote rooms are room instances which lives in a different process
 */

export class RemoteRoom {
    roomId: string;
    matchmaker: MatchMaker;

    constructor (roomId: string, matchmaker: MatchMaker) {
        this.roomId = roomId;
        this.matchmaker = matchmaker;
    }

    onMessage (client: Client, data: any): void {
        this.matchmaker.remoteRoomCall(this.roomId, "onMessage", [client, data]);
    }
}
