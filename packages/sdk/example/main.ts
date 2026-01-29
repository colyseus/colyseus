import { Client, Room, Callbacks } from '@colyseus/sdk';
import type { MyRoom } from "../../example/src/sdks.server";
import "@colyseus/sdk/debug";

// Get DOM elements
const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
const clearLogBtn = document.getElementById('clearLogBtn') as HTMLButtonElement;
const connectionStatus = document.getElementById('connectionStatus') as HTMLSpanElement;
const logDiv = document.getElementById('log') as HTMLDivElement;

// Manipulate state buttons
const addBotBtn = document.getElementById('addBotBtn') as HTMLButtonElement;
const removeBotBtn = document.getElementById('removeBotBtn') as HTMLButtonElement;
const addItemBtn = document.getElementById('addItemBtn') as HTMLButtonElement;
const removeItemBtn = document.getElementById('removeItemBtn') as HTMLButtonElement;

let client: Client | null = null;
let room: Room<MyRoom> | null = null;

// Logging utility
function log(message: string, type: 'info' | 'success' | 'error' | 'warn' = 'info') {
    const entry = document.createElement('div');
    const typeColors = {
        info: 'text-cyan-400',
        success: 'text-green-500',
        error: 'text-red-500',
        warn: 'text-orange-500'
    };
    entry.className = `mb-1 ${typeColors[type]}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
    console.log(`[${type.toUpperCase()}]`, message);
}

// Update UI state
function updateUIState() {
    const isInRoom = room !== null;

    addBotBtn.disabled = !isInRoom;
    removeBotBtn.disabled = !isInRoom;
    addItemBtn.disabled = !isInRoom;
    removeItemBtn.disabled = !isInRoom;

    if (isInRoom) {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'inline-block px-2 py-1 rounded text-xs font-medium bg-green-500 text-white';
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'inline-block px-2 py-1 rounded text-xs font-medium bg-red-500 text-white';
    }
}

// Auto-connect and join room
async function connect() {
    try {
        log('Connecting to http://localhost:2567...', 'info');
        client = new Client('http://localhost:2567');

        log('Joining room: my_room...', 'info');
        room = await client.joinOrCreate<MyRoom>('my_room');
        log(`Joined room: ${room.roomId}`, 'success');

        // Set up state callbacks
        const callbacks = Callbacks.get(room);

        callbacks.listen("currentTurn", (currentTurn) => {
            log(`Current turn: ${currentTurn}`, 'info');
        })

        callbacks.onAdd("players", (player, sessionId) => {
            const playerType = player.isBot ? 'Bot' : 'Player';
            log(`${playerType} added: ${sessionId}`, 'success');

            if (player.items) {
                callbacks.onAdd(player, "items", (item) => {
                    log(`Item added to ${sessionId}: ${item.name}`, 'info');
                });

                callbacks.onRemove(player, "items", (item) => {
                    log(`Item removed from ${sessionId}: ${item.name || 'unknown'}`, 'info');
                });
            }
        });

        callbacks.onRemove("players", (player, sessionId) => {
            const playerType = player.isBot ? 'Bot' : 'Player';
            log(`${playerType} removed: ${sessionId}`, 'warn');
        });

        room.onMessage('*', (type, message) => {
            log(`Message [${type}]: ${JSON.stringify(message)}`, 'info');
        });

        room.onError((code, message) => {
            log(`Room error [${code}]: ${message}`, 'error');
        });

        room.onLeave((code) => {
            log(`Left room (code: ${code})`, 'warn');
            room = null;
            updateUIState();
        });

        updateUIState();
    } catch (error) {
        log(`Connection error: ${error}`, 'error');
        client = null;
        room = null;
        updateUIState();
    }
}

// Disconnect
disconnectBtn.addEventListener('click', () => {
    if (room) {
        log('Leaving room...', 'info');
        room.leave();
        room = null;
    }
    client = null;
    updateUIState();
});

// Manipulate state buttons
addBotBtn.addEventListener('click', () => {
    if (!room) return;
    room.send('add_bot', { name: "bot_" + Date.now() });
    log('Requested to add bot', 'info');
});

removeBotBtn.addEventListener('click', () => {
    if (!room) return;
    room.send('remove_bot');
    log('Requested to remove bot', 'info');
});

addItemBtn.addEventListener('click', () => {
    if (!room) return;
    const itemName = `item_${Date.now()}`;
    room.send('add_item', { name: itemName });
    log(`Requested to add item: ${itemName}`, 'info');
});

removeItemBtn.addEventListener('click', () => {
    if (!room) return;
    room.send('remove_item', {});
    log('Requested to remove item', 'info');
});

// Clear log
clearLogBtn.addEventListener('click', () => {
    logDiv.innerHTML = '';
});

// Initialize
log('SDK Test App initialized', 'success');
log('Auto-connecting to server...', 'info');
connect();
