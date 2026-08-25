import { CloseCode } from "@colyseus/shared-types";
import { disconnectIcon, envelopeDown, envelopeUp, infoIcon, jitterIcon, logoIcon, messageIcon, resizeIcon, sizedIcon, treeViewIcon } from "./icons.ts";
import { applyPanelPosition, formatBytes, getBorderColor, getDebugRoot, getPanelStack, isPanelsHidden, preferences, PREDICT_CONTAINER_ID, repositionDebugPanels, roomDebugInfo, setCompactRevealed } from "./core.ts";
import { isCoarsePointer, isCompact, onReflow } from "./layout.ts";
import { createMenu } from "./menu.ts";
import { openSendMessagesModal } from "./send-message.ts";
import { openStateInspectorModal } from "./state-inspector.ts";


export function initialize() {
    if (isPanelsHidden()) return;

    var container = document.createElement('div');
    container.id = 'debug-logo-container';
    container.className = 'cds-surface';
    container.style.position = 'fixed';
    container.style.zIndex = '1000';
    container.style.width = '21px';
    container.style.height = '21px';
    container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    container.style.border = '3px solid ' + getBorderColor(preferences.latencySimulation.delay, 0.7);
    container.style.borderRadius = '50%';
    container.style.padding = '10px';
    container.style.boxSizing = 'content-box';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
    container.style.transition = 'border-color 0.3s ease, background-color 0.3s ease, transform 0.12s ease';
    container.style.cursor = 'pointer';

    // Apply initial position
    applyPanelPosition();

    // container on hover effect
    container.addEventListener('mouseenter', function() {
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        container.style.borderColor = getBorderColor(preferences.latencySimulation.delay, 0.9);
    });
    container.addEventListener('mouseleave', function() {
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        container.style.borderColor = getBorderColor(preferences.latencySimulation.delay, 0.7);
    });

    var icon = document.createElement('div');
    icon.style.width = '100%';
    icon.style.height = '100%';
    icon.style.display = 'flex';
    icon.style.justifyContent = 'center';
    icon.style.alignItems = 'center';

    // Use insertAdjacentHTML for better Safari compatibility with SVG
    icon.insertAdjacentHTML('beforeend', logoIcon);

    container.appendChild(icon);
    getDebugRoot().appendChild(container);

    // Create menu first
    createMenu(container);

    // Apply initial position after menu is created
    applyPanelPosition();

    watchPanelShape();
    bindTooltipDismiss();
}



// Helper function to create debug panel for a room
export function createDebugPanel(uniquePanelId, debugInfo) {
    // Check if panel already exists
    var existingPanel = getDebugRoot().getElementById('debug-panel-' + uniquePanelId);
    if (existingPanel) {
        return existingPanel;
    }

    var panel = document.createElement('div');
    panel.id = 'debug-panel-' + uniquePanelId;
    panel.className = 'cds-surface';
    // A flex child of the panel stack — the stack owns position and z-index.
    panel.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    panel.style.color = '#fff';
    panel.style.padding = '8px';
    panel.style.borderRadius = '6px';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '11px';
    panel.style.minWidth = '180px';
    panel.style.pointerEvents = 'auto'; // the desktop stack is pointer-events:none
    panel.style.flexShrink = '0'; // never squash inside the scrollable compact drawer
    panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    panel.style.display = isPanelsHidden() ? 'none' : 'block';

    var title = document.createElement('div');
    title.id = 'debug-title-' + uniquePanelId;
    title.className = 'debug-title'; // `[id^="debug-title-"]` would also catch debug-title-text-*
    title.style.fontWeight = 'bold';
    title.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    title.style.paddingBottom = '4px';
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.justifyContent = 'space-between';
    title.style.gap = '8px';
    title.style.position = 'relative';
    title.innerHTML = '<span id="debug-title-text-' + uniquePanelId + '"><span class="debug-room-name"></span><span class="debug-info-icon" style="display: inline-flex; align-items: center; margin-left: 4px; cursor: pointer; opacity: 0.6; vertical-align: middle;">' + resizeIcon(infoIcon, 10) + '</span></span><span style="display:flex;align-items:center;gap:8px;font-weight:normal"><span id="debug-ping-' + uniquePanelId + '" style="font-size: 10px; color: #888;" title="Ping time">--</span><span class="debug-chevron" style="color:#888;display:none">▾</span></span>';

    // Create tooltip for info button (will be shown on hover)
    var tooltip = document.createElement('div');
    tooltip.id = 'debug-tooltip-' + uniquePanelId;
    tooltip.style.position = 'absolute';
    tooltip.style.top = '100%';
    tooltip.style.left = '0';
    tooltip.style.marginTop = '4px';
    tooltip.style.padding = '6px 8px';
    tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
    tooltip.style.color = '#fff';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '10px';
    tooltip.style.fontFamily = 'monospace';
    tooltip.style.zIndex = '1000';
    tooltip.style.display = 'none';
    tooltip.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.5)';
    tooltip.style.lineHeight = '1.4';
    tooltip.innerHTML = '<div><strong>Room ID:</strong> ' + debugInfo.roomId + '</div><div><strong>Session ID:</strong> N/A</div>';

    var content = document.createElement('div');
    content.id = 'debug-content-' + uniquePanelId;

    // Create action buttons container at the bottom
    var actionsContainer = document.createElement('div');
    actionsContainer.id = 'debug-actions-' + uniquePanelId;
    actionsContainer.style.display = 'flex';
    actionsContainer.style.gap = '4px';
    actionsContainer.style.marginTop = '8px';
    actionsContainer.style.paddingTop = '6px';
    actionsContainer.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)';
    actionsContainer.style.position = 'relative';

    // Helper function to create action button
    function createActionButton(id, icon, label, onClick) {
        var btn = document.createElement('button');
        btn.id = id;
        btn.className = 'cds-hit';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.gap = '4px';
        btn.style.padding = '4px 8px';
        btn.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        btn.style.borderRadius = '4px';
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.color = '#fff';
        btn.style.fontSize = '9px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background 0.2s, border-color 0.2s';
        btn.innerHTML = sizedIcon(icon, 12) + '<span>' + label + '</span>';

        btn.addEventListener('mouseenter', function() {
            btn.style.background = 'rgba(255, 255, 255, 0.15)';
            btn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });
        btn.addEventListener('mouseleave', function() {
            btn.style.background = 'rgba(255, 255, 255, 0.05)';
            btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        });
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    // Create action buttons
    var stateBtn = createActionButton(
        'debug-state-btn-' + uniquePanelId,
        treeViewIcon,
        'State',
        function() { openStateInspectorModal(uniquePanelId); }
    );

    var messageBtn = createActionButton(
        'debug-message-btn-' + uniquePanelId,
        messageIcon,
        'Send',
        function() { openSendMessagesModal(uniquePanelId); }
    );
    messageBtn.style.display = 'none'; // Hidden by default, shown when message types available

    // Create disconnect button (red, simulates abnormal websocket close)
    var disconnectBtn = createActionButton(
        'debug-disconnect-btn-' + uniquePanelId,
        disconnectIcon,
        'Drop',
        function() {
            var info = roomDebugInfo.get(uniquePanelId);
            if (info && info.room && info.room.connection) {
                // Simulate connection closure
                info.room.connection.close(CloseCode.MAY_TRY_RECONNECT);
            }
        }
    );

    // Track button state for hover effects
    var isReconnecting = false;

    // Helper to apply normal (red) button style
    function applyNormalStyle() {
        disconnectBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        disconnectBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        disconnectBtn.style.color = '#ef4444';
        disconnectBtn.style.animation = '';
        disconnectBtn.style.pointerEvents = 'auto';
        disconnectBtn.style.opacity = '1';
        var labelSpan = disconnectBtn.querySelector('span:last-child') as HTMLElement;
        if (labelSpan) labelSpan.textContent = 'Drop';
    }

    // Helper to apply reconnecting (orange/pulsing) button style
    function applyReconnectingStyle() {
        disconnectBtn.style.background = 'rgba(251, 146, 60, 0.3)';
        disconnectBtn.style.borderColor = 'rgba(251, 146, 60, 0.6)';
        disconnectBtn.style.color = '#fb923c';
        disconnectBtn.style.animation = 'debug-pulse 1.5s ease-in-out infinite';
        disconnectBtn.style.pointerEvents = 'none';
        disconnectBtn.style.opacity = '0.8';
        var labelSpan = disconnectBtn.querySelector('span:last-child') as HTMLElement;
        if (labelSpan) labelSpan.textContent = 'Reconnecting...';
    }

    // Apply initial style (the debug-pulse keyframes live in the base sheet)
    applyNormalStyle();

    // Register onDrop callback to show reconnecting state
    if (debugInfo.room) {
        debugInfo.room.onDrop(function() {
            isReconnecting = true;
            applyReconnectingStyle();
        });

        // Register onReconnect callback to restore normal state
        debugInfo.room.onReconnect(function() {
            isReconnecting = false;
            applyNormalStyle();
        });
    }

    // Hover effects (only when not reconnecting)
    disconnectBtn.addEventListener('mouseenter', function() {
        if (!isReconnecting) {
            disconnectBtn.style.background = 'rgba(239, 68, 68, 0.35)';
            disconnectBtn.style.borderColor = 'rgba(239, 68, 68, 0.7)';
        }
    });
    disconnectBtn.addEventListener('mouseleave', function() {
        if (!isReconnecting) {
            disconnectBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            disconnectBtn.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        }
    });

    title.appendChild(tooltip);
    var infoIconEl = title.querySelector('.debug-info-icon') as HTMLElement;
    var tooltipTimeout: any = null;
    var showTooltip = function() {
        if (tooltipTimeout) { clearTimeout(tooltipTimeout); tooltipTimeout = null; }
        tooltip.style.display = 'block';
    };
    var hideTooltip = function() {
        tooltipTimeout = setTimeout(function() {
            tooltip.style.display = 'none';
        }, 100);
    };
    tooltip.style.pointerEvents = 'auto';

    if (infoIconEl) {
        // On touch, `mouseenter` fires on tap and no `mouseleave` ever follows, so a
        // hover tooltip sticks open forever. Room/session ids are worth surfacing on
        // a phone, so tap toggles it rather than suppressing it. The click stops here
        // — that is what keeps the outside-tap dismissal from immediately undoing it.
        infoIconEl.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!isCoarsePointer()) { return; }
            tooltip.style.display = (tooltip.style.display === 'block') ? 'none' : 'block';
        });
        infoIconEl.addEventListener('mouseenter', function() {
            if (!isCoarsePointer()) { showTooltip(); }
        });
        infoIconEl.addEventListener('mouseleave', function() {
            if (!isCoarsePointer()) { hideTooltip(); }
        });
        tooltip.addEventListener('mouseenter', showTooltip);
        tooltip.addEventListener('mouseleave', function() {
            if (!isCoarsePointer()) { hideTooltip(); }
        });
    }

    actionsContainer.appendChild(stateBtn);
    actionsContainer.appendChild(messageBtn);
    actionsContainer.appendChild(disconnectBtn);

    // Collapsible body: on a phone each room reduces to its title row (a chip) and
    // opens on tap. `content` stays the same element, so updateDebugPanel()'s
    // per-second innerHTML rewrite is unaffected.
    var body = document.createElement('div');
    body.id = 'debug-body-' + uniquePanelId;
    body.style.marginTop = '6px';
    body.appendChild(content);
    body.appendChild(actionsContainer);

    panel.appendChild(title);
    panel.appendChild(body);

    // Deliberately does not stop propagation: the click still needs to reach the
    // document listeners that close the menu and dismiss open tooltips.
    title.addEventListener('click', function() {
        if (!isCompact()) { return; } // desktop: always expanded, header inert
        setPanelExpanded(panel, panel.dataset.expanded !== '1');
    });

    setPanelExpanded(panel, true);

    // Creation order — oldest nearest the logo. In compact the Predict card is the
    // drawer's last child, so rooms have to go in ahead of it.
    var stack = getPanelStack();
    stack.insertBefore(panel, stack.querySelector('#' + PREDICT_CONTAINER_ID));

    return panel;
}


// Chip ⇄ full panel. The chevron only makes sense where the header is tappable.
function setPanelExpanded(panel: HTMLElement, expanded: boolean) {
    var body = panel.querySelector('[id^="debug-body-"]') as HTMLElement;
    var title = panel.querySelector('.debug-title') as HTMLElement;
    var chevron = panel.querySelector('.debug-chevron') as HTMLElement;
    var compact = isCompact();

    panel.dataset.expanded = expanded ? '1' : '0';
    if (body) { body.style.display = expanded ? 'block' : 'none'; }
    if (title) {
        title.style.cursor = compact ? 'pointer' : 'default';
        title.style.borderBottomColor = expanded ? 'rgba(255, 255, 255, 0.15)' : 'transparent';
        title.style.paddingBottom = expanded ? '4px' : '0';
    }
    if (chevron) {
        chevron.style.display = compact ? 'inline' : 'none';
        chevron.textContent = expanded ? '▾' : '▸';
    }
}


// Any tap outside an open info tooltip closes it. The icon that opens one stops the
// click there, so this never fires for the very tap that opened the tooltip.
function bindTooltipDismiss() {
    document.addEventListener('click', function() {
        var tooltips = getDebugRoot().querySelectorAll('[id^="debug-tooltip-"]') as NodeListOf<HTMLElement>;
        tooltips.forEach(function(tooltip) { tooltip.style.display = 'none'; });
    });
}


// Reshape the panels only when the breakpoint actually flips. reflow() also fires on
// every plain resize — including the mobile URL bar sliding away mid-scroll — and
// re-running this each time would reopen a panel the user just collapsed, or re-hide
// the drawer they just revealed.
function watchPanelShape() {
    var wasCompact = isCompact();
    onReflow(function(state) {
        if (state.compact === wasCompact) { return; }
        wasCompact = state.compact;
        // Entering compact hands the screen back to the game until the logo is tapped.
        if (state.compact) { setCompactRevealed(false); }
        // Reopen everything: the chevron only exists in compact, so a panel collapsed
        // there would have no way back once the header goes inert on desktop.
        var panels = getDebugRoot().querySelectorAll('[id^="debug-panel-"]') as NodeListOf<HTMLElement>;
        panels.forEach(function(panel) { setPanelExpanded(panel, true); });
    });
}


// Update debug panel content
export function updateDebugPanel(uniquePanelId, debugInfo) {
    var root = getDebugRoot();
    var contentId = 'debug-content-' + uniquePanelId;
    var panelId = 'debug-panel-' + uniquePanelId;
    var titleId = 'debug-title-' + uniquePanelId;
    var content = root.getElementById(contentId);
    var panel = root.getElementById(panelId);
    var title = root.getElementById(titleId);

    if (!content || !panel) {
        // Only create if panel doesn't exist
        if (!panel) {
            createDebugPanel(uniquePanelId, debugInfo);
            content = root.getElementById(contentId);
            title = root.getElementById(titleId);
            repositionDebugPanels();
        } else {
            content = root.getElementById(contentId);
            title = root.getElementById(titleId);
        }
    }

    // Update title with room name only (roomId and sessionId are in tooltip)
    var titleTextEl = root.getElementById('debug-title-text-' + uniquePanelId);
    var roomNameEl = titleTextEl?.querySelector('.debug-room-name');
    if (roomNameEl) roomNameEl.textContent = debugInfo.roomName;
    root.getElementById('debug-tooltip-' + uniquePanelId).innerHTML = '<div><strong>Room ID:</strong> ' + debugInfo.roomId + '</div><div><strong>Session ID:</strong> ' + debugInfo.sessionId + '</div>';

    // Update ping in header
    var pingDisplay = debugInfo.pingMs !== null ? debugInfo.pingMs + 'ms' : '--';
    var pingColor = debugInfo.pingMs !== null ? (debugInfo.pingMs < 100 ? '#22c55e' : debugInfo.pingMs < 200 ? '#eab308' : '#ef4444') : '#888';
    var pingElement = root.getElementById('debug-ping-' + uniquePanelId);
    if (pingElement) {
        pingElement.textContent = pingDisplay;
        pingElement.style.color = pingColor;
    }

    // Connection jitter (RoomClock.jitter) — only TIMED rooms advertise a patch
    // cadence, so non-input/NULL_CLOCK rooms (patchInterval 0) hide the row. Rendered
    // as its own stat row below — not in the header, which stays latency-only.
    var clock = debugInfo.room && debugInfo.room.clock;
    var hasJitter = !!(clock && typeof clock.jitter === 'function' && typeof clock.patchInterval === 'function' && clock.patchInterval() > 0);
    var jitterMs = hasJitter ? clock.jitter() : 0;
    var jitterText = (jitterMs < 10 ? jitterMs.toFixed(1) : jitterMs.toFixed(0)) + 'ms';

    var jitterAccent = '#a78bfa'; // violet — signature color for the jitter stat (icon + graph)

    var html = '<div style="line-height: 1.3;">';
    html += '<div style="font-size: 10px; display: flex; gap: 8px;">';
    html += '<div style="flex: 1;">';
    html += '<div style="margin-bottom: 4px;"><div style="display: flex; align-items: center; gap: 6px;"><span style="display: inline-flex; align-items: center; width: 18px; height: 18px; color: #FF9800;">' + envelopeUp + '</span><span style="color: #FF9800;">' + formatBytes(debugInfo.bytesSentPerSec) + '/s</span></div><div style="margin-left: 24px; opacity: 0.7; font-size: 9px;">' + debugInfo.messagesSentPerSec.toFixed(0) + ' messages</div></div>';
    html += '<div' + (hasJitter ? ' style="margin-bottom: 4px;"' : '') + '><div style="display: flex; align-items: center; gap: 6px;"><span style="display: inline-flex; align-items: center; width: 18px; height: 18px; color: #2196F3;">' + envelopeDown + '</span><span style="color: #2196F3;">' + formatBytes(debugInfo.bytesReceivedPerSec) + '/s</span></div><div style="margin-left: 24px; opacity: 0.7; font-size: 9px;">' + debugInfo.messagesReceivedPerSec.toFixed(0) + ' messages</div></div>';
    // Jitter: third stat row, same shape as sent/received (icon + label, value below).
    if (hasJitter) {
        html += '<div><div style="display: flex; align-items: center; gap: 6px;"><span style="display: inline-flex; align-items: center; width: 18px; height: 18px; color: ' + jitterAccent + ';">' + jitterIcon + '</span><span style="color: ' + jitterAccent + ';">jitter</span></div><div style="margin-left: 24px; opacity: 0.7; font-size: 9px;">±' + jitterText + '</div></div>';
    }
    html += '</div>';
    html += '<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">';
    html += '<canvas id="graph-sent-' + uniquePanelId + '" width="80" height="30" style="display: block;"></canvas>';
    html += '<canvas id="graph-received-' + uniquePanelId + '" width="80" height="30" style="display: block;"></canvas>';
    if (hasJitter) {
        html += '<canvas id="graph-jitter-' + uniquePanelId + '" width="80" height="30" style="display: block;"></canvas>';
    }
    html += '</div>';
    html += '</div>';
    html += '</div>';

    content.innerHTML = html;

    // Draw graphs after a short delay to ensure canvas elements are rendered
    setTimeout(function() {
        drawGraph('graph-sent-' + uniquePanelId, debugInfo.bytesSentHistory, '#FF9800');
        drawGraph('graph-received-' + uniquePanelId, debugInfo.bytesReceivedHistory, '#2196F3');
        if (hasJitter) drawGraph('graph-jitter-' + uniquePanelId, debugInfo.jitterHistory, jitterAccent);
    }, 10);
}


// Draw graph on canvas
export function drawGraph(canvasId, data, color) {
    var canvas = getDebugRoot().getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;

    var ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    var width = canvas.width;
    var height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (!data || data.length === 0) return;

    // Find min and max values
    var maxValue = Math.max.apply(Math, data);
    var minValue = Math.min.apply(Math, data);
    var range = maxValue - minValue || 1; // Avoid division by zero

    // Padding
    var padding = 2;
    var graphWidth = width - padding * 2;
    var graphHeight = height - padding * 2;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) {
        var y = padding + (graphHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    // Draw the line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (var i = 0; i < data.length; i++) {
        var x = padding + (graphWidth / (data.length - 1 || 1)) * i;
        var normalizedValue = (data[i] - minValue) / range;
        var y = padding + graphHeight - (normalizedValue * graphHeight);

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Fill area under the line
    if (data.length > 0) {
        ctx.lineTo(width - padding, height - padding);
        ctx.lineTo(padding, height - padding);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}


// Calculate per-second rates
export function calculateRates(debugInfo) {
    var now = Date.now();
    var elapsed = (now - debugInfo.lastUpdate) / 1000; // seconds

    if (elapsed > 0) {
        debugInfo.bytesSentPerSec = debugInfo.bytesSentDelta / elapsed;
        debugInfo.bytesReceivedPerSec = debugInfo.bytesReceivedDelta / elapsed;
        debugInfo.messagesSentPerSec = debugInfo.messagesSentDelta / elapsed;
        debugInfo.messagesReceivedPerSec = debugInfo.messagesReceivedDelta / elapsed;

        // Add to history
        debugInfo.bytesSentHistory.push(debugInfo.bytesSentPerSec);
        debugInfo.bytesReceivedHistory.push(debugInfo.bytesReceivedPerSec);
        // debugInfo.historyTimestamps.push(now);

        // Snapshot the clock's jitter EMA into the history ring (TIMED rooms only).
        var jitterClock = debugInfo.room && debugInfo.room.clock;
        if (jitterClock && typeof jitterClock.jitter === 'function' && typeof jitterClock.patchInterval === 'function' && jitterClock.patchInterval() > 0) {
            debugInfo.jitterHistory.push(jitterClock.jitter());
        }

        // Limit history length
        var maxLen = debugInfo.maxHistoryLength || 60;
        if (debugInfo.bytesSentHistory.length > maxLen) {
            debugInfo.bytesSentHistory.shift();
            debugInfo.bytesReceivedHistory.shift();
            // debugInfo.historyTimestamps.shift();
        }
        if (debugInfo.jitterHistory.length > maxLen) {
            debugInfo.jitterHistory.shift();
        }

        // Reset deltas
        debugInfo.bytesSentDelta = 0;
        debugInfo.bytesReceivedDelta = 0;
        debugInfo.messagesSentDelta = 0;
        debugInfo.messagesReceivedDelta = 0;
        debugInfo.lastUpdate = now;
    }

    // Update panel
    updateDebugPanel(debugInfo.uniquePanelId, debugInfo);
}
