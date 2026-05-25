import { Client } from "./Client.ts";
import type { Room } from "./Room.ts";
import type { WebSocketTransport } from "./transport/WebSocketTransport.ts";
import { getDebugRoot, loadPreferences, preferences, repositionDebugPanels, roomDebugInfo } from "./debug/core.ts";
import { calculateRates, initialize, updateDebugPanel } from "./debug/panel.ts";

// Single interval for all panels
let globalUpdateInterval = null;

// Load preferences on script load
loadPreferences();

// Start global update interval if not already running
function ensureGlobalUpdateInterval() {
    if (globalUpdateInterval === null) {
        globalUpdateInterval = setInterval(function() {
            // Loop through all panels and calculate rates
            roomDebugInfo.forEach(function(debugInfo, uniquePanelId) {
                calculateRates(debugInfo);
            });

            // Clean up interval if no more panels
            if (roomDebugInfo.size === 0) {
                clearInterval(globalUpdateInterval);
                globalUpdateInterval = null;
            }
        }, 1000);
    }
}

function applyMonkeyPatches() {

    // Helper function to patch a room
    function patchRoom(room: Room) {
        if (!room) { return room; }

        // Generate a consistent room ID
        const roomId = room.roomId;
        const sessionId = room.sessionId;

        // Generate unique panel ID: use roomId + sessionId to avoid collisions
        // when the same sessionId is reused across rooms (e.g. QueueRoom handoff)
        const uniquePanelId = roomId + '_' + (sessionId && sessionId !== 'N/A' && sessionId !== ''
            ? sessionId
            : Date.now() + '-' + Math.random().toString(36).substring(2, 9));

        const transport = room.connection?.transport as WebSocketTransport;
        const endpoint = transport.ws?.url || 'N/A';

        const debugInfo = {
            uniquePanelId: uniquePanelId,
            roomId: roomId,
            roomName: room.name || 'N/A',
            sessionId: sessionId || 'N/A',
            endpoint,
            host: new URL(endpoint).host,
            room, // Store room reference for state inspector
            bytesSent: 0,
            bytesReceived: 0,
            messagesSent: 0,
            messagesReceived: 0,
            bytesSentDelta: 0,
            bytesReceivedDelta: 0,
            messagesSentDelta: 0,
            messagesReceivedDelta: 0,
            bytesSentPerSec: 0,
            bytesReceivedPerSec: 0,
            messagesSentPerSec: 0,
            messagesReceivedPerSec: 0,
            lastUpdate: Date.now(),
            bytesSentHistory: [],
            bytesReceivedHistory: [],
            // historyTimestamps: [],
            maxHistoryLength: 60, // Keep last 60 data points (1 minute at 1 second intervals)
            messageTypes: null, // Will store message types from __playground_message_types
            pingMs: null as number | null, // Current ping value in milliseconds
            pingInterval: null as any // Interval for pinging the room
        };

        roomDebugInfo.set(uniquePanelId, debugInfo);

        // Start ping interval (every 2 seconds)
        debugInfo.pingInterval = setInterval(() => {
            room.ping((ms: number) => {
                debugInfo.pingMs = ms;
            });
        }, 2000);

        // Initial ping
        room.ping((ms: number) => {
            debugInfo.pingMs = ms;
        });

        // Listen for __playground_message_types message
        room.onMessage('__playground_message_types', (messageTypes: any) => {
            debugInfo.messageTypes = messageTypes;

            // Show/hide message button based on message types availability
            var messageBtnElement = getDebugRoot().getElementById('debug-message-btn-' + uniquePanelId);
            if (messageBtnElement) {
                messageBtnElement.style.display = messageTypes ? 'flex' : 'none';
            }
        });

        // Helper function to track received message/bytes
        function trackReceivedMessage(data) {
            // Calculate bytes received
            var bytes = 0;
            if (data instanceof Blob) {
                bytes = data.size;
            } else if (data instanceof ArrayBuffer) {
                bytes = data.byteLength;
            } else if (typeof data === 'string') {
                bytes = new Blob([data]).size;
            } else if (data) {
                try {
                    bytes = new Blob([JSON.stringify(data)]).size;
                } catch (e) {
                    bytes = new Blob([String(data)]).size;
                }
            }

            //
            // TODO: avoid trackig __playground_message_types messages in the stats
            //
            debugInfo.messagesReceived++;
            debugInfo.messagesReceivedDelta++;
            debugInfo.bytesReceived += bytes;
            debugInfo.bytesReceivedDelta += bytes;
        }

        function trackSentMessage(data) {
            var bytes = 0;
            if (data instanceof Blob) {
                bytes = data.size;
            } else if (data instanceof ArrayBuffer) {
                bytes = data.byteLength;
            } else if (typeof data === 'string') {
                bytes = new Blob([data]).size;
            }
            debugInfo.messagesSent++;
            debugInfo.messagesSentDelta++;
            debugInfo.bytesSent += data.length;
            debugInfo.bytesSentDelta += data.length;
        }

        // Monkey-patch: track received messages through onmessage event
        const originalOnMessage = transport.events.onmessage;
        transport.events.onmessage = function(event) {
            // Clone event data to avoid issues with delayed processing
            var eventData = event.data;
            if (eventData instanceof Blob) {
                eventData = eventData.slice();
            } else if (eventData instanceof ArrayBuffer) {
                eventData = eventData.slice(0);
            } else if (typeof eventData === 'string') {
                eventData = eventData;
            }

            trackReceivedMessage(eventData);

            // Apply latency simulation for received messages
            if (preferences.latencySimulation.enabled && preferences.latencySimulation.delay > 0) {
                setTimeout(function() {
                    // Create a synthetic event-like object
                    var syntheticEvent = {
                        data: eventData,
                        target: event.target,
                        currentTarget: event.currentTarget,
                        type: 'message'
                    };
                    originalOnMessage.call(event.target, syntheticEvent);
                }, preferences.latencySimulation.delay);
            } else {
                return originalOnMessage.apply(this, arguments as any);
            }
        };

        // Monkey-patch: delay onclose so it fires AFTER any pending onmessage
        // callbacks scheduled via setTimeout (latency simulation). Without this,
        // onclose → onLeave → clearRefs() runs before delayed messages are
        // decoded, causing "refId not found" schema decoder errors.
        const originalOnClose = transport.events.onclose;
        transport.events.onclose = function(event) {
            if (preferences.latencySimulation.enabled && preferences.latencySimulation.delay > 0) {
                setTimeout(function(this: any) {
                    if (originalOnClose) originalOnClose.call(this, event);
                }, preferences.latencySimulation.delay + 1);
            } else {
                if (originalOnClose) return originalOnClose.apply(this, arguments as any);
            }
        };

        // Monkey-patch: sending messages through room connection
        const originalSend = room.connection.send.bind(room.connection);
        room.connection.send = function(data: any) {
            trackSentMessage(data);

            // Apply latency simulation for sent messages
            if (preferences.latencySimulation.enabled && preferences.latencySimulation.delay > 0) {
                var clonedData = data;
                if (data instanceof ArrayBuffer) {
                    clonedData = data.slice(0);
                } else if (data instanceof Blob) {
                    clonedData = data.slice(0);
                } else if (data instanceof Uint8Array || data instanceof DataView || (data.buffer && data.buffer instanceof ArrayBuffer)) {
                    clonedData = new Uint8Array(data).buffer;
                }

                setTimeout(function() {
                    originalSend(clonedData);
                }, preferences.latencySimulation.delay / 2);
            } else {
                return originalSend(data);
            }
        };

        updateDebugPanel(uniquePanelId, debugInfo);

        // Ensure global update interval is running
        ensureGlobalUpdateInterval();

        // Clean up on room leave
        room.onLeave.once(() => {
            // Clear ping interval
            if (debugInfo.pingInterval !== null) {
                clearInterval(debugInfo.pingInterval);
                debugInfo.pingInterval = null;
            }
            roomDebugInfo.delete(uniquePanelId);
            var panel = getDebugRoot().getElementById('debug-panel-' + uniquePanelId);
            if (panel) {
                panel.remove();
                repositionDebugPanels();
            }
            // Clean up interval if no more panels
            if (roomDebugInfo.size === 0 && globalUpdateInterval !== null) {
                clearInterval(globalUpdateInterval);
                globalUpdateInterval = null;
            }
        });


        return room;
    }

    // Patch consumeSeatReservation to intercept all room connections
    var originalConsumeSeatReservation = Client.prototype.consumeSeatReservation;
    Client.prototype.consumeSeatReservation = function() {
        var promise = originalConsumeSeatReservation.apply(this, arguments as any);
        return promise.then((room) => patchRoom(room));
    };

}

applyMonkeyPatches();

// Initialize only after DOM is ready
// (in case script is loaded in HEAD tag)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    // DOM is already ready
    initialize();
}
