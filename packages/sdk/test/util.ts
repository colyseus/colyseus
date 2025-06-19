import { LocalStorage } from "node-localstorage";

// mock WebSocket
(<any>global).WebSocket = class WebSocket { send() {} };

// mock localStorage
(<any>global).window = { localStorage: new LocalStorage('./test') };
