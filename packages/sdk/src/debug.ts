import { Client } from "./Client.ts";
import type { Room } from "./Room.ts";
import { authInstances, getDebugRoot, loadPreferences, preferences, repositionDebugPanels, roomDebugInfo, savePreferences } from "./debug/core.ts";
import { calculateRates, initialize, updateDebugPanel } from "./debug/panel.ts";
import { installPredictDebug } from "./debug/predict.ts";

// Open the registry consumers depend on — Predict (and any future client-side
// extension that wants a debug surface) publishes here.
installPredictDebug();

// Single interval for all panels
let globalUpdateInterval = null;

// Load preferences on script load
loadPreferences();

// Order-preserving jittered delay. Returns the setTimeout ms, or -1 when sim is off.
// `cursor.t` is a monotonic delivery clock: each message lands at max(now+base±jitter,
// previous+0.5ms), so jitter perturbs message SPACING without reordering — the reliable
// schema decoder never sees an out-of-order patch (which would corrupt the delta stream).
function jitteredDelay(base: number, jit: number, cursor: { t: number }): number {
    if (!preferences.latencySimulation.enabled || (base <= 0 && jit <= 0)) return -1;
    // Symmetric U[-jit,jit] jitter — perturbs message SPACING without reordering.
    const j = jit > 0 ? (Math.random() * 2 - 1) * jit : 0;
    const now = performance.now();
    const at = Math.max(now + base + j, cursor.t + 0.5);
    cursor.t = at;
    return at - now;
}

// Console API to drive the network simulator: `__net(80, 40)` = 80ms round-trip
// latency ± 40ms jitter, split evenly across both directions. `__net()` clears it.
(globalThis as { __net?: (delay?: number, jitter?: number) => void }).__net = (delay = 0, jitter = 0) => {
    preferences.latencySimulation.delay = delay;
    preferences.latencySimulation.jitter = jitter;
    preferences.latencySimulation.enabled = delay > 0 || jitter > 0;
    savePreferences();
    console.log(`[net] RTT ${delay}±${jitter}ms (split both ways) — ${delay > 0 || jitter > 0 ? "ON" : "OFF"}`);
};

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

        const transport = room.connection?.transport as any;
        // WebSocket transports expose `ws.url`; h3/WebTransport exposes `url`.
        const endpoint = transport?.ws?.url ?? transport?.url ?? 'N/A';
        let host = 'N/A';
        try { host = new URL(endpoint).host; } catch { /* non-URL endpoint (h3 / 'N/A') */ }

        const debugInfo = {
            uniquePanelId: uniquePanelId,
            roomId: roomId,
            roomName: room.name || 'N/A',
            sessionId: sessionId || 'N/A',
            endpoint,
            host,
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
            jitterHistory: [] as number[], // per-second snapshots of room.clock.jitter() for the sparkline
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

        // Per-connection delivery cursors so jittered messages stay in arrival order.
        const inCursor = { t: 0 }, outCursor = { t: 0 };

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

            // Apply latency simulation (order-preserving jitter) for received messages.
            // The `delay`/`jitter` sliders are ROUND-TRIP values, split evenly across
            // the two directions — so each path applies half (send path mirrors this).
            const wait = jitteredDelay(preferences.latencySimulation.delay / 2, preferences.latencySimulation.jitter / 2, inCursor);
            if (wait >= 0) {
                setTimeout(function() {
                    // Create a synthetic event-like object
                    var syntheticEvent = {
                        data: eventData,
                        target: event.target,
                        currentTarget: event.currentTarget,
                        type: 'message'
                    };
                    originalOnMessage.call(event.target, syntheticEvent);
                }, wait);
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
                }, preferences.latencySimulation.delay + preferences.latencySimulation.jitter + 1);
            } else {
                if (originalOnClose) return originalOnClose.apply(this, arguments as any);
            }
        };

        // Monkey-patch: sending messages through room connection
        const originalSend = room.connection.send.bind(room.connection);
        room.connection.send = function(data: any) {
            trackSentMessage(data);

            // Apply latency simulation (order-preserving jitter) for sent messages —
            // half the round-trip slider value, mirroring the receive path above.
            const wait = jitteredDelay(preferences.latencySimulation.delay / 2, preferences.latencySimulation.jitter / 2, outCursor);
            if (wait >= 0) {
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
                }, wait);
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

    // Capture live `client.auth` on every matchmake attempt so the "Clear auth
    // token" dev-tool can null the in-memory token (not just storage). These run
    // BEFORE the server responds, so a token rejected by onAuth is still captured
    // — consumeSeatReservation is too late (it never runs when onAuth fails).
    ['joinOrCreate', 'join', 'create', 'joinById', 'reconnect'].forEach((method) => {
        const original = (Client.prototype as any)[method];
        if (typeof original !== 'function') { return; }
        (Client.prototype as any)[method] = function(this: any, ...args: any[]) {
            if (this.auth) { authInstances.add(this.auth); }
            return original.apply(this, args);
        };
    });

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
