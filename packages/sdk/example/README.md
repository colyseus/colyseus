# Colyseus SDK Test App

A simple Vite-based web application for testing the Colyseus SDK in a browser environment.

## Usage

1. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

2. Start the test app:
   ```bash
   npm run test:app
   ```

   This will start a Vite dev server on `http://localhost:3001` and automatically open it in your browser.

3. Make sure you have a Colyseus server running (e.g., on `ws://localhost:2567`)

4. In the test app:
   - Enter your server endpoint (default: `ws://localhost:2567`)
   - Enter a room name (default: `my_room`)
   - Click "Connect" to create a client
   - Click "Join Room" to join or create a room
   - Use "Send Message" to send messages to the server
   - View logs in the log panel

## Features

- Connect/disconnect from Colyseus server
- Join/leave rooms
- Send messages to the server
- View room state changes
- View incoming messages
- View connection status
- Real-time logging

## Files

- `index.html` - Main HTML file with UI
- `main.ts` - TypeScript entry point with SDK test logic
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript configuration

