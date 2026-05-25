import { CloseCode } from "@colyseus/shared-types";
import { disconnectIcon, envelopeDown, envelopeUp, infoIcon, logoIcon, messageIcon, settingsIcon, treeViewIcon } from "./icons.ts";
import { applyPanelPosition, formatBytes, getBorderColor, getDebugRoot, isPanelsHidden, preferences, repositionDebugPanels, roomDebugInfo, savePreferences } from "./core.ts";
import { openSettingsModal } from "./settings.ts";
import { openSendMessagesModal } from "./send-message.ts";
import { openStateInspectorModal } from "./state-inspector.ts";


export function initialize() {
    if (isPanelsHidden()) return;

    var container = document.createElement('div');
    container.id = 'debug-logo-container';
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
    container.style.transition = 'border-color 0.3s ease, background-color 0.3s ease';
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
}


// Create menu that opens on logo click
export function createMenu(logoContainer) {
    var menu = document.createElement('div');
    menu.id = 'debug-menu';
    menu.style.position = 'fixed';
    // Position will be set by applyPanelPosition
    menu.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
    menu.style.color = '#fff';
    menu.style.padding = '0 0 8px 0';
    menu.style.borderRadius = '6px';
    menu.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    menu.style.fontSize = '12px';
    menu.style.zIndex = '1001';
    menu.style.minWidth = '200px';
    menu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    menu.style.display = 'none';
    menu.style.overflow = 'hidden';

    // Host name display
    var hostContainer = document.createElement('div');
    hostContainer.style.padding = '6px 12px';
    hostContainer.style.cursor = 'default';
    hostContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    hostContainer.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    hostContainer.style.marginBottom = '4px';
    hostContainer.style.borderTopLeftRadius = '6px';
    hostContainer.style.borderTopRightRadius = '6px';

    var hostValue = document.createElement('div');
    hostValue.id = 'debug-menu-host';
    hostValue.style.fontSize = '11px';
    hostValue.style.color = '#fff';
    hostValue.style.fontFamily = 'monospace';
    hostValue.style.whiteSpace = 'nowrap';
    hostValue.style.overflow = 'hidden';
    hostValue.style.textOverflow = 'ellipsis';
    hostValue.style.textAlign = 'center';
    hostValue.style.fontWeight = '500';

    // Function to update host display
    function updateHostDisplay() {
        var hostText = 'N/A';
        if (roomDebugInfo.size > 0) {
            // Get host from first room
            var firstRoom = roomDebugInfo.values().next().value;
            if (firstRoom && firstRoom.host) {
                hostText = firstRoom.host;
            }
        }
        hostValue.textContent = hostText;
    }

    // Update host display initially
    updateHostDisplay();

    hostContainer.appendChild(hostValue);
    menu.appendChild(hostContainer);

    // Simulate latency option
    var latencyContainer = document.createElement('div');
    latencyContainer.style.padding = '8px 12px';
    latencyContainer.style.cursor = 'default';

    var latencyLabel = document.createElement('div');
    latencyLabel.style.marginBottom = '8px';
    latencyLabel.style.display = 'flex';
    latencyLabel.style.alignItems = 'center';
    latencyLabel.style.justifyContent = 'space-between';
    var latencyValueSpan = document.createElement('span');
    latencyValueSpan.id = 'latency-value';
    latencyValueSpan.style.color = '#888';
    latencyValueSpan.style.fontSize = '11px';
    latencyValueSpan.textContent = preferences.latencySimulation.delay + 'ms';

    var latencyTextSpan = document.createElement('span');
    latencyTextSpan.textContent = 'Simulate latency';

    latencyLabel.appendChild(latencyTextSpan);
    latencyLabel.appendChild(latencyValueSpan);

    var latencySlider = document.createElement('input');
    latencySlider.type = 'range';
    latencySlider.min = '0';
    latencySlider.max = preferences.maxLatency.toString();
    latencySlider.value = preferences.latencySimulation.delay.toString();
    latencySlider.style.border = 'none';
    latencySlider.style.width = '100%';
    latencySlider.style.height = '20px';
    latencySlider.style.padding = '0';
    latencySlider.style.margin = '0';
    latencySlider.style.outline = 'none';
    latencySlider.style.cursor = 'pointer';
    latencySlider.style.webkitAppearance = 'none';
    latencySlider.style.appearance = 'none';
    latencySlider.style.background = 'transparent';
    latencySlider.id = 'latency-slider';

    // Function to calculate color from green (0) -> yellow (250) -> red (500)
    function getSliderColor(value, min, max) {
        var percentage = (value - min) / (max - min);
        var r, g, b = 0;

        if (percentage <= 0.5) {
            // Green to Yellow: (0, 200, 0) -> (200, 200, 0)
            var segmentPercent = percentage * 2; // 0 to 1 for this segment
            r = Math.round(segmentPercent * 200);
            g = 200;
        } else {
            // Yellow to Red: (200, 200, 0) -> (200, 0, 0)
            var segmentPercent = (percentage - 0.5) * 2; // 0 to 1 for this segment
            r = 200;
            g = Math.round((1 - segmentPercent) * 200);
        }

        return 'rgb(' + r + ', ' + g + ', ' + b + ')';
    }

    // Function to update slider track color
    function updateSliderColor(value) {
        var color = getSliderColor(value, 0, preferences.maxLatency);
        var valuePercent = (value / preferences.maxLatency) * 100;
        var yellowPercent = 50; // Yellow at 250ms (50% of 500ms)
        var gradient;

        if (value <= preferences.maxLatency / 2) {
            // Value is in green->yellow range: show green -> yellow
            var yellowColor = getSliderColor(preferences.maxLatency / 2, 0, preferences.maxLatency);
            gradient = `linear-gradient(to right, #00c800 0%, ${yellowColor} ${valuePercent}%, #333 ${valuePercent}%, #333 100%)`;
        } else {
            // Value is in yellow->red range: show green -> yellow -> current color
            var yellowColor = getSliderColor(preferences.maxLatency / 2, 0, preferences.maxLatency);
            gradient = `linear-gradient(to right, #00c800 0%, ${yellowColor} ${yellowPercent}%, ${color} ${valuePercent}%, #333 ${valuePercent}%, #333 100%)`;
        }

        var styleId = 'latency-slider-style';
        var root = getDebugRoot();
        var existingStyle = root.getElementById(styleId);
        if (existingStyle) {
            existingStyle.remove();
        }
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #latency-slider::-webkit-slider-runnable-track {
                background: ${gradient};
                height: 6px;
                border-radius: 3px;
                border: none;
            }
            #latency-slider::-moz-range-track {
                background: ${gradient};
                height: 6px;
                border-radius: 3px;
                border: none;
            }
        `;
        root.appendChild(style);
    }

    // Initialize slider color
    updateSliderColor(parseInt(latencySlider.value));

    // Add custom styling via CSS (inline style limitations)
    var style = document.createElement('style');
    style.textContent = `
        #latency-slider {
            background: transparent !important;
            background-color: transparent !important;
        }
        #latency-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            background-color: #fff;
            cursor: pointer;
            border: 2px solid #888;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            transition: transform 0.1s ease, box-shadow 0.1s ease;
            margin-top: -5px;
        }
        #latency-slider::-webkit-slider-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
        }
        #latency-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            cursor: pointer;
            border: 2px solid #888;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            transition: transform 0.1s ease, box-shadow 0.1s ease;
        }
        #latency-slider::-moz-range-thumb:hover {
            transform: scale(1.1);
            box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
        }
    `;
    getDebugRoot().appendChild(style);

    // Function to update container border color
    function updateContainerBackgroundColor() {
        var container = getDebugRoot().getElementById('debug-logo-container');
        if (container) {
            // Update to normal state (hover handlers will update on hover)
            container.style.borderColor = getBorderColor(preferences.latencySimulation.delay, 0.7);
        }
    }

    // Update latency value display
    latencySlider.addEventListener('input', function() {
        var value = parseInt(latencySlider.value);
        latencyValueSpan.textContent = value + 'ms';
        preferences.latencySimulation.delay = value;
        preferences.latencySimulation.enabled = value > 0;
        updateSliderColor(value);
        updateContainerBackgroundColor();
        savePreferences();
    });

    latencyContainer.appendChild(latencyLabel);
    latencyContainer.appendChild(latencySlider);
    menu.appendChild(latencyContainer);

    // Separator
    var separator = document.createElement('div');
    separator.style.height = '1px';
    separator.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
    separator.style.margin = '4px 0';
    menu.appendChild(separator);

    // Settings option
    var settingsOption = document.createElement('div');
    settingsOption.style.padding = '8px 12px';
    settingsOption.style.cursor = 'pointer';
    settingsOption.style.transition = 'background-color 0.2s';
    settingsOption.style.display = 'flex';
    settingsOption.style.alignItems = 'center';
    settingsOption.style.gap = '8px';

    var settingsIconWrapper = document.createElement('span');
    settingsIconWrapper.style.display = 'inline-flex';
    settingsIconWrapper.style.alignItems = 'center';
    settingsIconWrapper.style.width = '16px';
    settingsIconWrapper.style.height = '16px';
    settingsIconWrapper.innerHTML = settingsIcon.replace('height="200px" width="200px"', 'height="16" width="16"');

    var settingsText = document.createElement('span');
    settingsText.textContent = 'Preferences';

    settingsOption.appendChild(settingsIconWrapper);
    settingsOption.appendChild(settingsText);

    settingsOption.addEventListener('mouseenter', function() {
        settingsOption.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    settingsOption.addEventListener('mouseleave', function() {
        settingsOption.style.backgroundColor = 'transparent';
    });
    settingsOption.addEventListener('click', function(e) {
        e.stopPropagation();
        menuVisible = false;
        menu.style.display = 'none';
        if (hostUpdateInterval) {
            clearInterval(hostUpdateInterval);
            hostUpdateInterval = null;
        }
        openSettingsModal();
    });
    menu.appendChild(settingsOption);

    getDebugRoot().appendChild(menu);

    // Toggle menu on logo click
    var menuVisible = false;
    var hostUpdateInterval = null;
    logoContainer.addEventListener('click', function(e) {
        e.stopPropagation();
        menuVisible = !menuVisible;
        menu.style.display = menuVisible ? 'block' : 'none';

        if (menuVisible) {
            updateHostDisplay();
            // Update host every second while menu is visible
            hostUpdateInterval = setInterval(updateHostDisplay, 1000);
        } else {
            if (hostUpdateInterval) {
                clearInterval(hostUpdateInterval);
                hostUpdateInterval = null;
            }
        }
    });

    // Close menu when clicking outside.
    // Because menu/logo live inside a shadow root, event.target is retargeted
    // to the shadow host for document-level listeners, so we walk the composed
    // path to see whether the real click target was inside the menu or logo.
    document.addEventListener('click', function(e) {
        var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target as EventTarget];
        var clickedInsideMenu = path.indexOf(menu) !== -1;
        var clickedInsideLogo = path.indexOf(logoContainer) !== -1;
        if (menuVisible && !clickedInsideMenu && !clickedInsideLogo) {
            menuVisible = false;
            menu.style.display = 'none';
            if (hostUpdateInterval) {
                clearInterval(hostUpdateInterval);
                hostUpdateInterval = null;
            }
        }
    });
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
    panel.style.position = 'fixed';
    // Position will be set by repositionDebugPanels
    panel.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    panel.style.color = '#fff';
    panel.style.padding = '8px';
    panel.style.borderRadius = '6px';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '11px';
    panel.style.zIndex = '999';
    panel.style.minWidth = '180px';
    panel.style.marginRight = '6px';
    panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    panel.style.display = isPanelsHidden() ? 'none' : 'block';

    var title = document.createElement('div');
    title.id = 'debug-title-' + uniquePanelId;
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '6px';
    title.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    title.style.paddingBottom = '4px';
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.justifyContent = 'space-between';
    title.style.gap = '8px';
    title.style.position = 'relative';
    title.innerHTML = '<span id="debug-title-text-' + uniquePanelId + '"><span class="debug-room-name"></span><span class="debug-info-icon" style="display: inline-flex; align-items: center; margin-left: 4px; cursor: pointer; opacity: 0.6; vertical-align: middle;">' + infoIcon.replace('height="200px" width="200px"', 'height="10" width="10"') + '</span></span><span id="debug-ping-' + uniquePanelId + '" style="font-size: 10px; font-weight: normal; color: #888;" title="Ping time">--</span>';

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
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '4px';
        btn.style.padding = '4px 8px';
        btn.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        btn.style.borderRadius = '4px';
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.color = '#fff';
        btn.style.fontSize = '9px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background 0.2s, border-color 0.2s';
        btn.innerHTML = '<span style="display: inline-flex; align-items: center; width: 12px; height: 12px;">' + icon + '</span><span>' + label + '</span>';

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
        treeViewIcon.replace('height="200px" width="200px"', 'height="12" width="12"'),
        'State',
        function() { openStateInspectorModal(uniquePanelId); }
    );

    var messageBtn = createActionButton(
        'debug-message-btn-' + uniquePanelId,
        messageIcon.replace('height="200px" width="200px"', 'height="12" width="12"'),
        'Send',
        function() { openSendMessagesModal(uniquePanelId); }
    );
    messageBtn.style.display = 'none'; // Hidden by default, shown when message types available

    // Create disconnect button (red, simulates abnormal websocket close)
    var disconnectBtn = createActionButton(
        'debug-disconnect-btn-' + uniquePanelId,
        disconnectIcon.replace('height="200px" width="200px"', 'height="12" width="12"'),
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

    // Inject CSS animation if not already present
    var pulseRoot = getDebugRoot();
    if (!pulseRoot.getElementById('debug-pulse-animation')) {
        var style = document.createElement('style');
        style.id = 'debug-pulse-animation';
        style.textContent = '@keyframes debug-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }';
        pulseRoot.appendChild(style);
    }

    // Apply initial style
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

    // Add tooltip hover handlers to info icon in title
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
    if (infoIconEl) {
        infoIconEl.addEventListener('mouseenter', showTooltip);
        infoIconEl.addEventListener('mouseleave', hideTooltip);
    }
    tooltip.style.pointerEvents = 'auto';
    tooltip.addEventListener('mouseenter', showTooltip);
    tooltip.addEventListener('mouseleave', hideTooltip);

    actionsContainer.appendChild(stateBtn);
    actionsContainer.appendChild(messageBtn);
    actionsContainer.appendChild(disconnectBtn);

    panel.appendChild(title);
    panel.appendChild(content);
    panel.appendChild(actionsContainer);

    // Prepend panel inside the shadow root so new panels appear first
    var root = getDebugRoot();
    if (root.firstChild) {
        root.insertBefore(panel, root.firstChild);
    } else {
        root.appendChild(panel);
    }

    return panel;
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

    var html = '<div style="line-height: 1.3;">';
    html += '<div style="font-size: 10px; display: flex; gap: 8px;">';
    html += '<div style="flex: 1;">';
    html += '<div style="margin-bottom: 4px;"><div style="display: flex; align-items: center; gap: 6px;"><span style="display: inline-flex; align-items: center; width: 18px; height: 18px; color: #FF9800;">' + envelopeUp + '</span><span style="color: #FF9800;">' + formatBytes(debugInfo.bytesSentPerSec) + '/s</span></div><div style="margin-left: 24px; opacity: 0.7; font-size: 9px;">' + debugInfo.messagesSentPerSec.toFixed(0) + ' messages</div></div>';
    html += '<div><div style="display: flex; align-items: center; gap: 6px;"><span style="display: inline-flex; align-items: center; width: 18px; height: 18px; color: #2196F3;">' + envelopeDown + '</span><span style="color: #2196F3;">' + formatBytes(debugInfo.bytesReceivedPerSec) + '/s</span></div><div style="margin-left: 24px; opacity: 0.7; font-size: 9px;">' + debugInfo.messagesReceivedPerSec.toFixed(0) + ' messages</div></div>';
    html += '</div>';
    html += '<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">';
    html += '<canvas id="graph-sent-' + uniquePanelId + '" width="80" height="30" style="display: block;"></canvas>';
    html += '<canvas id="graph-received-' + uniquePanelId + '" width="80" height="30" style="display: block;"></canvas>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    content.innerHTML = html;

    // Draw graphs after a short delay to ensure canvas elements are rendered
    setTimeout(function() {
        drawGraph('graph-sent-' + uniquePanelId, debugInfo.bytesSentHistory, '#FF9800');
        drawGraph('graph-received-' + uniquePanelId, debugInfo.bytesReceivedHistory, '#2196F3');
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

        // Limit history length
        var maxLen = debugInfo.maxHistoryLength || 60;
        if (debugInfo.bytesSentHistory.length > maxLen) {
            debugInfo.bytesSentHistory.shift();
            debugInfo.bytesReceivedHistory.shift();
            // debugInfo.historyTimestamps.shift();
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
