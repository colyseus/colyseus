import { Client, Room } from '@colyseus/sdk';
import "@colyseus/sdk/debug";

// Get DOM elements
const endpointInput = document.getElementById('endpoint') as HTMLInputElement;
const roomNameInput = document.getElementById('roomName') as HTMLInputElement;
const messageInput = document.getElementById('message') as HTMLInputElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;
const leaveBtn = document.getElementById('leaveBtn') as HTMLButtonElement;
const sendMessageBtn = document.getElementById('sendMessageBtn') as HTMLButtonElement;
const clearLogBtn = document.getElementById('clearLogBtn') as HTMLButtonElement;
const connectionStatus = document.getElementById('connectionStatus') as HTMLSpanElement;
const logDiv = document.getElementById('log') as HTMLDivElement;

let client: Client | null = null;
let room: Room | null = null;

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
  const isConnected = client !== null;
  const isInRoom = room !== null;

  connectBtn.disabled = isConnected;
  disconnectBtn.disabled = !isConnected;
  joinBtn.disabled = !isConnected || isInRoom;
  leaveBtn.disabled = !isInRoom;
  sendMessageBtn.disabled = !isInRoom;

  if (isConnected) {
    connectionStatus.textContent = isInRoom ? 'In Room' : 'Connected';
    connectionStatus.className = 'inline-block px-2 py-1 rounded text-xs font-medium ml-2.5 bg-green-500 text-white';
  } else {
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'inline-block px-2 py-1 rounded text-xs font-medium ml-2.5 bg-red-500 text-white';
  }
}

// Connect to server
connectBtn.addEventListener('click', async () => {
  try {
    const endpoint = endpointInput.value.trim();
    if (!endpoint) {
      log('Please enter a server endpoint', 'error');
      return;
    }

    log(`Connecting to ${endpoint}...`, 'info');
    connectionStatus.textContent = 'Connecting...';
    connectionStatus.className = 'inline-block px-2 py-1 rounded text-xs font-medium ml-2.5 bg-orange-500 text-white';

    client = new Client(endpoint);
    log('Client created successfully', 'success');

    updateUIState();
    log('Ready to join rooms', 'success');
  } catch (error) {
    log(`Connection error: ${error}`, 'error');
    client = null;
    updateUIState();
  }
});

// Disconnect from server
disconnectBtn.addEventListener('click', () => {
  if (room) {
    room.leave();
    room = null;
  }
  if (client) {
    client = null;
  }
  log('Disconnected from server', 'info');
  updateUIState();
});

// Join room
joinBtn.addEventListener('click', async () => {
  if (!client) {
    log('Not connected to server', 'error');
    return;
  }

  try {
    const roomName = roomNameInput.value.trim() || 'my_room';
    log(`Joining room: ${roomName}...`, 'info');

    room = await client.joinOrCreate(roomName);
    log(`Joined room: ${room.roomId}`, 'success');

    // Set up room event handlers
    room.onStateChange((state) => {
      log(`Room state changed: ${JSON.stringify(state)}`, 'info');
    });

    room.onMessage('*', (type, message) => {
      log(`Received message [${type}]: ${JSON.stringify(message)}`, 'info');
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
    log(`Failed to join room: ${error}`, 'error');
    room = null;
    updateUIState();
  }
});

// Leave room
leaveBtn.addEventListener('click', () => {
  if (room) {
    log('Leaving room...', 'info');
    room.leave();
    room = null;
    updateUIState();
  }
});

// Send message
sendMessageBtn.addEventListener('click', () => {
  if (!room) {
    log('Not in a room', 'error');
    return;
  }

  const message = messageInput.value.trim();
  if (!message) {
    log('Please enter a message', 'warn');
    return;
  }

  try {
    room.send('message', message);
    log(`Sent message: ${message}`, 'success');
  } catch (error) {
    log(`Failed to send message: ${error}`, 'error');
  }
});

// Clear log
clearLogBtn.addEventListener('click', () => {
  logDiv.innerHTML = '';
});

// Initialize UI
updateUIState();
log('SDK Test App initialized', 'success');
log('Enter server endpoint and click Connect to begin', 'info');

