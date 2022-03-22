import { Room, Client, generateId } from "colyseus";
import { ExampleRoomState, ExampleNetworkedEntity, ExampleNetworkedUser } from "./schema/ExampleRoomState";

export class MyRoom extends Room<ExampleRoomState> {

    clientEntities = new Map<string, string[]>();
    serverTime: number = 0;
    roomOptions: any;

    /**
     * Callback for when the room is created
     */
    async onCreate(options: any) {
        console.log("\n*********************** MyRoom Created ***********************");
        console.log(options);
        console.log("***********************\n");

        this.maxClients = 25;
        this.roomOptions = options;

        //
        // Set state schema
        //
        this.setState(new ExampleRoomState());

        //
        // The patch-rate is the frequency which state mutations are sent to all clients. (in milliseconds)
        // 1000 / 20 means 20 times per second (50 milliseconds)
        //
        this.setPatchRate(1000 / 20);

        //
        // Set the callback for the "customMethod" message
        // https://docs.colyseus.io/server/room/#onmessage-type-callback
        //
        this.onMessage("customMethod", (client: Client, request: any) => {
            // Implement your logic here
        });

        // Set the callback for the "entityUpdate" message
        this.onMessage("entityUpdate", (client: Client, entityUpdateArray: any) => {
            if (this.state.networkedEntities.has(`${entityUpdateArray[0]}`) === false) return;

            this.onEntityUpdate(client.sessionId, entityUpdateArray);
        });

        //
        // Set the callback for the "removeFunctionCall" message
        //
        this.onMessage("remoteFunctionCall", (client: Client, RFCMessage: any) => {
            //Confirm Sending Client is Owner
            if (this.state.networkedEntities.has(`${RFCMessage.entityId}`) === false) return;

            RFCMessage.clientId = client.sessionId;

            // Broadcast the "remoteFunctionCall" to all clients except the one the message originated from
            this.broadcast("onRFC", RFCMessage, RFCMessage.target == 0 ? {} : { except: client });
        });

        //
        // Set the callback for the "setAttribute" message to set an entity or user attribute
        //
        this.onMessage("setAttribute", (client: Client, attributeUpdateMessage: any) => {
            if (attributeUpdateMessage == null
                || (attributeUpdateMessage.entityId == null && attributeUpdateMessage.userId == null)
                || attributeUpdateMessage.attributesToSet == null) {
                return; // Invalid Attribute Update Message
            }

            // Set entity attribute
            if (attributeUpdateMessage.entityId) {
                //Check if this client owns the object
                if (this.state.networkedEntities.has(`${attributeUpdateMessage.entityId}`) === false) return;

                this.state.networkedEntities.get(`${attributeUpdateMessage.entityId}`).timestamp = parseFloat(this.serverTime.toString());
                let entityAttributes = this.state.networkedEntities.get(`${attributeUpdateMessage.entityId}`).attributes;
                for (let index = 0; index < Object.keys(attributeUpdateMessage.attributesToSet).length; index++) {
                    let key = Object.keys(attributeUpdateMessage.attributesToSet)[index];
                    let value = attributeUpdateMessage.attributesToSet[key];
                    entityAttributes.set(key, value);
                }
            }
            // Set user attribute
            else if (attributeUpdateMessage.userId) {

                //Check is this client ownes the object
                if (this.state.networkedUsers.has(`${attributeUpdateMessage.userId}`) === false) {
                    console.error(`Set Attribute - User Attribute - Room does not have networked user with Id - \"${attributeUpdateMessage.userId}\"`);
                    return;
                }

                this.state.networkedUsers.get(`${attributeUpdateMessage.userId}`).timestamp = parseFloat(this.serverTime.toString());

                let userAttributes = this.state.networkedUsers.get(`${attributeUpdateMessage.userId}`).attributes;

                for (let index = 0; index < Object.keys(attributeUpdateMessage.attributesToSet).length; index++) {
                    let key = Object.keys(attributeUpdateMessage.attributesToSet)[index];
                    let value = attributeUpdateMessage.attributesToSet[key];
                    userAttributes.set(key, value);
                }
            }

        });

        //
        // Set the callback for the "removeEntity" message
        //
        this.onMessage("removeEntity", (client: Client, removeId: string) => {
            if (this.state.networkedEntities.has(removeId)) {
                this.state.networkedEntities.delete(removeId);
            }
        });

        //
        // Set the callback for the "createEntity" message
        //
        this.onMessage("createEntity", (client: Client, creationMessage: any) => {
            // Generate new UID for the entity
            let entityViewID = generateId();
            let newEntity = new ExampleNetworkedEntity().assign({
                id: entityViewID,
                ownerId: client.sessionId,
                timestamp: this.serverTime
            });

            if (creationMessage.creationId != null) newEntity.creationId = creationMessage.creationId;

            newEntity.timestamp = parseFloat(this.serverTime.toString());

            for (let key in creationMessage.attributes) {
                if (key === "creationPos") {
                    newEntity.xPos = parseFloat(creationMessage.attributes[key][0]);
                    newEntity.yPos = parseFloat(creationMessage.attributes[key][1]);
                    newEntity.zPos = parseFloat(creationMessage.attributes[key][2]);
                }
                else if (key === "creationRot") {
                    newEntity.xRot = parseFloat(creationMessage.attributes[key][0]);
                    newEntity.yRot = parseFloat(creationMessage.attributes[key][1]);
                    newEntity.zRot = parseFloat(creationMessage.attributes[key][2]);
                    newEntity.wRot = parseFloat(creationMessage.attributes[key][3]);
                }
                else {
                    newEntity.attributes.set(key, creationMessage.attributes[key].toString());
                }
            }

            // Add the entity to the room state's networkedEntities map
            this.state.networkedEntities.set(entityViewID, newEntity);

            // Add the entity to the client entities collection
            if (this.clientEntities.has(client.sessionId)) {
                this.clientEntities.get(client.sessionId).push(entityViewID);
            } else {
                this.clientEntities.set(client.sessionId, [entityViewID]);
            }
        });

        // Set the callback for the "ping" message for tracking server-client latency
        this.onMessage("ping", (client: Client) => {
            client.send(0, { serverTime: this.serverTime });
        });

        this.setSimulationInterval((dt) => this.onGameLoop(dt));
    }

    // Callback when a client has joined the room
    onJoin(client: Client, options: any) {
        console.info(`Client joined!- ${client.sessionId} ***`);

        let newNetworkedUser = new ExampleNetworkedUser().assign({
            sessionId: client.sessionId,
        });

        this.state.networkedUsers.set(client.sessionId, newNetworkedUser);

        client.send("onJoin", newNetworkedUser);
    }

    onGameLoop(dt: number) {
        this.serverTime += dt;

        //
        // This is your game loop.
        // Run your game logic here.
        //
    }

    /**
     * Callback for the "entityUpdate" message from the client to update an entity
     * @param {*} clientID
     * @param {*} data
     */
    onEntityUpdate(clientID: string, data: any) {
        if (this.state.networkedEntities.has(`${data[0]}`) === false) return;

        let stateToUpdate = this.state.networkedEntities.get(data[0]);

        let startIndex = 1;
        if (data[1] === "attributes") startIndex = 2;

        for (let i = startIndex; i < data.length; i += 2) {
            const property = data[i];
            let updateValue = data[i + 1];
            if (updateValue === "inc") {
                updateValue = data[i + 2];
                updateValue = parseFloat(stateToUpdate.attributes.get(property)) + parseFloat(updateValue);
                i++; // inc i once more since we had a inc;
            }

            if (startIndex == 2) {
                stateToUpdate.attributes.set(property, updateValue.toString());
            } else {
                (stateToUpdate as any)[property] = updateValue;
            }
        }

        stateToUpdate.timestamp = parseFloat(this.serverTime.toString());
    }

    //
    // Callback when a client has left the room
    // https://docs.colyseus.io/server/room/#onleave-client-consented
    //
    // Read about handling reconnection:
    // https://docs.colyseus.io/server/room/#allowreconnection-client-seconds
    //
    async onLeave(client: Client, consented: boolean) {
        let networkedUser = this.state.networkedUsers.get(client.sessionId);

        if (networkedUser) {
            networkedUser.connected = false;
        }

        console.log(`*** User Leave - ${client.sessionId} ***`);
        // this.clientEntities is keyed by client.sessionId
        // this.state.networkedUsers is keyed by client.sessionid

        try {
            if (consented) {
                throw new Error("consented leave!");
            }

            console.info("let's wait for reconnection for client: " + client.sessionId);
            const newClient = await this.allowReconnection(client, 10);
            console.info("reconnected! client: " + newClient.sessionId);

        } catch (e) {
            console.info("disconnected! client: " + client.sessionId);
            console.log(`*** Removing Networked User and Entity ${client.sessionId} ***`);

            // remove user
            this.state.networkedUsers.delete(client.sessionId);

            // remove entities
            if (this.clientEntities.has(client.sessionId)) {
                let allClientEntities = this.clientEntities.get(client.sessionId);
                allClientEntities.forEach(element => {

                    this.state.networkedEntities.delete(element);
                });

                // remove the client from clientEntities
                this.clientEntities.delete(client.sessionId);
            }
            else {
                console.error(`Can't remove entities for ${client.sessionId} - No entry in Client Entities!`);
            }
        }
    }

    onDispose() {
        console.log("*********************** MyRoom disposed ***********************");
    }

}
