import redis, { RedisClient } from 'redis';
const os = require('os');
// console.log( os.hostname() );
// console.log( os);

const MY_POD_NAMESPACE = process.env.MY_POD_NAMESPACE || 'localDockerNS';
const MY_POD_NAME = process.env.MY_POD_NAME || os.hostname();
const MY_POD_IP = process.env.MY_POD_IP || os.hostname();
const API_KEY = process.env.API_KEY || 'devkey';
const DEBUG_REDISPROXY = process.env.DEBUG_REDISPROXY || undefined;


let timer: NodeJS.Timeout;
let client: RedisClient;

export async function initializeProxyRedis(opts?: redis.ClientOpts, sendServerUp?: boolean) {
    client = redis.createClient(opts);

    client.on("connect", () => {
        // console.log("REDIS Connected");
        if(sendServerUp) {
            this.sendServerStateNotice(true);
        }
    });

    client.on("error", function(error) {
        console.error("PROXY REDIS ERROR: " + error);
    });

    if(DEBUG_REDISPROXY) {
        const subscribe = redis.createClient(opts);
        subscribe.on("message", function (channel, message) {
            console.log("Message: " + message + " on channel: " + channel + " is arrive!");
        });
        subscribe.subscribe(API_KEY+"_ServerState", (status) => {
            console.log("server state listen ready");
        }); 
    
        const subscribe2 = redis.createClient(opts);
        subscribe2.on("message", function (channel, message) {
            console.log("Message: " + message + " on channel: " + channel + " is arrive!");
        });
        subscribe2.subscribe(API_KEY+"_RoomState", (status) => {
            console.log("room state listen ready");
        }); 
    }

    
}

export async function sendServerStateNotice(online: boolean) {
    if(client == null) {
        console.log("Redis Proxy Not Initialized")
        return;
    }

    let ServerOnlineMsg = {
        MY_POD_NAME : MY_POD_NAME,
        MY_POD_IP : MY_POD_IP,
        MY_POD_NAMESPACE : MY_POD_NAMESPACE,
        API_KEY : API_KEY,
        state: online
    };

    client.publish(API_KEY+"_ServerState", JSON.stringify(ServerOnlineMsg), function(){
        if(online === false)
            console.log("Sending Proxy Notice: Server is shutting down");
    });

    //Polling Online
    if(timer == null && online === true) {
        timer = setInterval(()=> {
            this.sendServerStateNotice(true);
        }, 10000);
    }
    else if(online === false) {
        clearInterval(timer);
        timer = null;
    }

}

export async function sendRoomStateNotice(roomID: string, open: boolean) {
    if(client == null) {
        console.log("Redis Proxy Not Initialized")
        return;
    }

    let RoomOnlineMsg = {
        MY_POD_NAME : MY_POD_NAME,
        MY_POD_IP : MY_POD_IP,
        MY_POD_NAMESPACE : MY_POD_NAMESPACE,
        API_KEY : API_KEY,
        roomID: roomID,
        state: open
    };

    client.publish(API_KEY+"_RoomState", JSON.stringify(RoomOnlineMsg), function(){
        // console.log("Room State Message Sent");
    });
}


export async function getClient() {
    if(client == null) {
        console.log("Redis Proxy Not Initialized")
        return null;
    }

    return client;
}
