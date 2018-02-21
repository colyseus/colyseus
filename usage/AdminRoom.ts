import { Room, EntityMap, Client, nosync } from "../src";

class State {
    data: EntityMap<ServerData> = {};

}

class ServerData {

}

export class AdminRoom extends Room<any> {

    onInit (options) {
        console.log("AdminRoom created!", options);

        this.setState(new State());
    }

    verifyClient(client: Client, options: any): boolean | Promise<any>
    {
        return options.username == "admin" && options.password == "admin";
    }

    onJoin (client) {
    }

    onLeave (client) {
    }

    onMessage (client, data) {
        console.log("AdminRoom received message from", client.sessionId, ":", data);
    }

    onDispose () {
        console.log("Dispose AdminRoom");
    }

}