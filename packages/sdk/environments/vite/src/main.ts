import { createApp } from 'vue'
import { Client } from "colyseus.js";
import App from './App.vue'

const client = new Client("ws://localhost:2567");
client.joinOrCreate("my_room").then((room: any) => {
    room.onStateChange((state: any) => {
        console.log("onStateChange", state);
    });
    room.onLeave((code: number) => console.log("onLeave:", { code }));
});

createApp(App).mount('#app')
