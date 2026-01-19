import { Client } from "./Client.ts";
import type { Room } from "./Room.ts";
import type { WebSocketTransport } from "./transport/WebSocketTransport.ts";
import { CloseCode } from "@colyseus/shared-types";

const logoIcon = `<svg viewBox="0 0 488.94 541.2" style="width: 100%; height: 100%;">
  <g>
    <g>
      <path fill="#ffffff" d="m80.42,197.14c13.82,11.25,30.56,22.25,50.78,32.11,14.87-28.67,72.09-100.71,233.32-79.68l-14.4-55.35c-200.24-17.18-257.81,77.11-269.7,102.92Z"/>
      <path fill="#ffffff" d="m44.53,167.77c22.44-40.73,99.17-124.23,290.19-105.83L310.19,1.59S109.9-21.63,8.9,109.47c3.62,10.55,13.31,33.34,35.63,58.29Z"/>
      <path fill="#ffffff" d="m407.7,291.25c-32.14,3.35-62.02,4.95-89.63,4.95C123.09,296.2,36.78,219.6,0,164.95v251.98s15.77,162.98,488.94,115.66l-81.24-241.33Z"/>
    </g>
  </g>
</svg>`;
const envelopeUp = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4.5a.5.5 0 0 1-1 0V5.383l-7 4.2-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h5.5a.5.5 0 0 1 0 1H2a2 2 0 0 1-2-1.99zm1 7.105 4.708-2.897L1 5.383zM1 4v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1"></path><path d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m.354-5.354 1.25 1.25a.5.5 0 0 1-.708.708L13 12.207V14a.5.5 0 0 1-1 0v-1.717l-.28.305a.5.5 0 0 1-.737-.676l1.149-1.25a.5.5 0 0 1 .722-.016"></path></svg>`;
const envelopeDown = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 16 16" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4.5a.5.5 0 0 1-1 0V5.383l-7 4.2-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h5.5a.5.5 0 0 1 0 1H2a2 2 0 0 1-2-1.99zm1 7.105 4.708-2.897L1 5.383zM1 4v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1"></path><path d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m.354-1.646a.5.5 0 0 1-.722-.016l-1.149-1.25a.5.5 0 1 1 .737-.676l.28.305V11a.5.5 0 0 1 1 0v1.793l.396-.397a.5.5 0 0 1 .708.708z"></path></svg>`;
const messageIcon = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.8 4.2-10.7L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/></svg>`;
const treeViewIcon = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 256 256" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path d="M160,136v-8H88v64a8,8,0,0,0,8,8h64v-8a16,16,0,0,1,16-16h32a16,16,0,0,1,16,16v32a16,16,0,0,1-16,16H176a16,16,0,0,1-16-16v-8H96a24,24,0,0,1-24-24V80H64A16,16,0,0,1,48,64V32A16,16,0,0,1,64,16H96a16,16,0,0,1,16,16V64A16,16,0,0,1,96,80H88v32h72v-8a16,16,0,0,1,16-16h32a16,16,0,0,1,16,16v32a16,16,0,0,1-16,16H176A16,16,0,0,1,160,136Z"></path></svg>`;
const infoIcon = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path d="M256 48C141.2 48 48 141.2 48 256s93.2 208 208 208 208-93.2 208-208S370.8 48 256 48zm21 312h-42V235h42v125zm0-166h-42v-42h42v42z"></path></svg>`;
const settingsIcon = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path d="M12.003 21c-.732 .001 -1.465 -.438 -1.678 -1.317a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c.886 .215 1.325 .957 1.318 1.694"></path><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"></path><path d="M19.001 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M19.001 15.5v1.5"></path><path d="M19.001 21v1.5"></path><path d="M22.032 17.25l-1.299 .75"></path><path d="M17.27 20l-1.3 .75"></path><path d="M15.97 17.25l1.3 .75"></path><path d="M20.733 20l1.3 .75"></path></svg>`;
const eyeSlashIcon = `<svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="16" width="16" xmlns="http://www.w3.org/2000/svg"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
const closeIcon = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path d="M400 145.49 366.51 112 256 222.51 145.49 112 112 145.49 222.51 256 112 366.51 145.49 400 256 289.49 366.51 400 400 366.51 289.49 256 400 145.49z"></path></svg>`;
const disconnectIcon = `<svg fill="currentColor" viewBox="0 0 36 36" height="200px" width="200px"><path fill="currentColor" d="M18 24.42a4 4 0 1 0 4 4a4 4 0 0 0-4-4m0 6a2 2 0 1 1 2-2a2 2 0 0 1-2 2" class="clr-i-outline clr-i-outline-path-1"></path><path fill="currentColor" d="M26.21 21.85a1 1 0 0 0-.23-1.4a13.6 13.6 0 0 0-5-2.23l3.87 3.87a1 1 0 0 0 1.36-.24" class="clr-i-outline clr-i-outline-path-2"></path><path fill="currentColor" d="M18.05 10.72a21 21 0 0 0-4.16.43l1.74 1.74a19 19 0 0 1 2.42-.17A18.76 18.76 0 0 1 28.64 16a1 1 0 0 0 1.12-1.65a20.75 20.75 0 0 0-11.71-3.63" class="clr-i-outline clr-i-outline-path-3"></path><path fill="currentColor" d="M33.55 8.2A28.11 28.11 0 0 0 8.11 5.36l1.58 1.57a26 26 0 0 1 22.76 2.94a1 1 0 0 0 1.1-1.67" class="clr-i-outline clr-i-outline-path-4"></path><path fill="currentColor" d="m1.84 4.75l2.43 2.43c-.62.34-1.23.7-1.83 1.1a1 1 0 1 0 1.12 1.66C4.26 9.47 5 9 5.74 8.65l3.87 3.87a20.6 20.6 0 0 0-3.38 1.88A1 1 0 0 0 7.36 16a18.8 18.8 0 0 1 3.77-2l4.16 4.16A13.5 13.5 0 0 0 10 20.55a1 1 0 0 0 1.18 1.61A11.5 11.5 0 0 1 17 20l10.8 10.8l1.41-1.41l-26-26Z" class="clr-i-outline clr-i-outline-path-5"></path><path fill="none" d="M0 0h36v36H0z"></path></svg>`;

// Store debug info per room
const roomDebugInfo = new Map();

// Single interval for all panels
let globalUpdateInterval = null;

// Preferences state
const preferences = {
    maxLatency: 350, // milliseconds
    latencySimulation: {
        enabled: false,
        delay: 0 // milliseconds
    },
    panelPosition: {
        position: 'top-right' // 'bottom-right', 'bottom-left', 'top-left', 'top-right'
    }
};

// Load preferences from localStorage
function loadPreferences() {
    try {
        const savedPrefs = localStorage.getItem('colyseus-debug-preferences') || '{}';
        const prefs = JSON.parse(savedPrefs);

        // Load position
        if (prefs.position && ['bottom-right', 'bottom-left', 'top-left', 'top-right'].includes(prefs.position)) {
            preferences.panelPosition.position = prefs.position;
        }

        // Load latency
        if (prefs.latency !== undefined && prefs.latency !== null) {
            const latencyValue = parseInt(prefs.latency, 10);
            if (!isNaN(latencyValue) && latencyValue >= 0 && latencyValue <= 500) {
                preferences.latencySimulation.delay = latencyValue;
                preferences.latencySimulation.enabled = latencyValue > 0;
            }
        }

        // Load hidden state
        if (prefs.hidden === true) {
            panelsHidden = true;
        }
    } catch (e) {
        // localStorage might not be available or JSON parse failed, ignore
    }
}

// Save preferences to localStorage
function savePreferences() {
    try {
        localStorage.setItem('colyseus-debug-preferences', JSON.stringify({
            position: preferences.panelPosition.position,
            latency: preferences.latencySimulation.delay,
            hidden: panelsHidden
        }));
    } catch (e) {
        // localStorage might not be available, ignore
    }
}

// Panel visibility state
let panelsHidden = false;

// Track open modals as an ordered stack (most recent at end)
let modalStack: any[] = [];
const BASE_MODAL_ZINDEX = 10000;

// Load preferences on script load
loadPreferences();

// Function to select a modal (bring to front)
function selectModal(modal) {
    if (!modal) return;

    // Remove modal from stack if already present
    const index = modalStack.indexOf(modal);
    if (index > -1) {
        modalStack.splice(index, 1);
    }

    // Add to end of stack (most recent)
    modalStack.push(modal);

    // Update z-indexes for all modals based on their position in stack
    modalStack.forEach((m, i) => {
        if (document.body.contains(m)) {
            m.style.zIndex = (BASE_MODAL_ZINDEX + i).toString();
        }
    });
}

// Function to remove modal from stack
function removeModalFromStack(modal) {
    const index = modalStack.indexOf(modal);
    if (index > -1) {
        modalStack.splice(index, 1);
    }
}

// Global ESC key handler - closes most recent modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modalStack.length > 0) {
        // Get the most recent modal (top of stack)
        const topModal = modalStack[modalStack.length - 1];
        if (topModal && document.body.contains(topModal)) {
            topModal.remove();
        }
    }
});

// Shared modal creation utilities
function createModalOverlay() {
    var overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = BASE_MODAL_ZINDEX.toString();
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    return overlay;
}

function createModal(options) {
    var opts = options || {};
    var modal = document.createElement('div');

    // Set ID if provided
    if (opts.id) {
        modal.id = opts.id;
    }

    // Base styles
    modal.style.position = 'fixed';
    modal.style.backgroundColor = opts.backgroundColor || '#1e1e1e';
    modal.style.borderRadius = '8px';
    modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    modal.style.color = '#fff';
    modal.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    modal.style.zIndex = BASE_MODAL_ZINDEX.toString();
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';

    // Size
    if (opts.width) modal.style.width = opts.width;
    if (opts.height) modal.style.height = opts.height;
    if (opts.minWidth) modal.style.minWidth = opts.minWidth;
    if (opts.minHeight) modal.style.minHeight = opts.minHeight;
    if (opts.maxWidth) modal.style.maxWidth = opts.maxWidth;
    if (opts.maxHeight) modal.style.maxHeight = opts.maxHeight;

    // Position
    modal.style.top = opts.top || '50%';
    modal.style.left = opts.left || '50%';
    modal.style.transform = opts.transform || 'translate(-50%, -50%)';

    // Mark modal as selected when clicked
    modal.addEventListener('mousedown', function(e) {
        selectModal(modal);
    });

    // Mark modal as selected when opened
    selectModal(modal);

    // Override remove to cleanup modal from stack
    var originalRemove = modal.remove.bind(modal);
    modal.remove = function() {
        // Remove from modal stack
        removeModalFromStack(modal);

        // Auto-cleanup room onLeave listener
        if (opts.room && opts.trackOnLeave && opts.onLeaveCallback) {
            var callbackToRemove = opts.onLeaveCallback.current || opts.onLeaveCallback;
            opts.room.onLeave.remove(callbackToRemove);
        }

        if (opts.onRemove) {
            opts.onRemove();
        }
        originalRemove();
    };

    return modal;
}

function createModalHeader(options) {
    var opts = options || {};

    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = opts.padding || '8px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    header.style.paddingBottom = opts.paddingBottom || '4px';
    header.style.marginBottom = opts.marginBottom || '6px';
    header.style.cursor = opts.draggable !== false ? 'move' : 'default';
    header.style.userSelect = 'none';
    header.style.flexShrink = '0';
    header.style.position = 'relative';
    header.style.zIndex = '1';

    // Title
    var title = document.createElement('div');
    title.textContent = opts.title || '';
    title.style.margin = '0';
    title.style.fontSize = opts.titleSize || '11px';
    title.style.fontWeight = 'bold';
    title.style.fontFamily = opts.titleFont || 'monospace';
    title.style.flex = '1';
    title.style.display = 'flex';
    title.style.alignItems = 'center';

    // Status dot (optional)
    if (opts.statusDot) {
        var statusDot = document.createElement('div');
        statusDot.style.width = '8px';
        statusDot.style.height = '8px';
        statusDot.style.borderRadius = '50%';
        statusDot.style.marginRight = '8px';
        statusDot.style.flexShrink = '0';
        statusDot.style.transition = 'background-color 0.3s';
        statusDot.style.backgroundColor = opts.statusColor || '#22c55e';
        title.insertBefore(statusDot, title.firstChild);

        if (opts.statusDotRef) {
            opts.statusDotRef.element = statusDot;
        }
    }

    // Close button
    var closeButton = document.createElement('button');
    closeButton.innerHTML = closeIcon;
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.color = '#fff';
    closeButton.style.fontSize = '18px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.padding = '0';
    closeButton.style.margin = 'auto';
    closeButton.style.width = '20px';
    closeButton.style.height = '20px';
    closeButton.style.display = 'flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.style.borderRadius = '4px';
    closeButton.style.transition = 'background-color 0.2s';
    closeButton.style.opacity = '0.6';

    closeButton.addEventListener('mouseenter', function() {
        closeButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.opacity = '1';
    });
    closeButton.addEventListener('mouseleave', function() {
        closeButton.style.backgroundColor = 'transparent';
        closeButton.style.opacity = '0.6';
    });
    closeButton.addEventListener('click', function(e) {
        e.stopPropagation();
        if (opts.onClose) {
            opts.onClose();
        } else if (opts.modal) {
            opts.modal.remove();
        }
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    return { header: header, title: title, closeButton: closeButton };
}

function makeDraggable(modal, dragHandle) {
    var isDragging = false;
    var dragOffsetX = 0;
    var dragOffsetY = 0;

    dragHandle.addEventListener('mousedown', function(e) {
        isDragging = true;
        var rect = modal.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        // Set position to current absolute position before removing transform
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
        modal.style.transform = 'none';
        e.preventDefault();
    });

    var onMouseMove = function(e) {
        if (isDragging) {
            var newLeft = e.clientX - dragOffsetX;
            var newTop = e.clientY - dragOffsetY;
            modal.style.left = newLeft + 'px';
            modal.style.top = newTop + 'px';
        }
    };

    var onMouseUp = function() {
        isDragging = false;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Return cleanup function
    return function cleanup() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };
}

// Function to get border color based on latency simulation value
function getBorderColor(latencyValue, opacity) {
    var maxLatency = preferences.maxLatency;
    var percentage = latencyValue / maxLatency;
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

    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + opacity + ')';
}

function initialize() {
    if (panelsHidden) return;

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
    document.body.appendChild(container);

    // Create menu first
    createMenu(container);

    // Apply initial position after menu is created
    applyPanelPosition();
}

// Create menu that opens on logo click
function createMenu(logoContainer) {
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
        var existingStyle = document.getElementById(styleId);
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
        document.head.appendChild(style);
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
    document.head.appendChild(style);

    // Function to update container border color
    function updateContainerBackgroundColor() {
        var container = document.getElementById('debug-logo-container');
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

    document.body.appendChild(menu);

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

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
        if (menuVisible && !menu.contains(e.target as Node) && !logoContainer.contains(e.target as Node)) {
            menuVisible = false;
            menu.style.display = 'none';
            if (hostUpdateInterval) {
                clearInterval(hostUpdateInterval);
                hostUpdateInterval = null;
            }
        }
    });
}

// Create and open Settings modal
function openSettingsModal() {
    // Remove existing modal if present
    var existingModal = document.getElementById('debug-settings-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Create overlay using shared utility
    var overlay = createModalOverlay();
    overlay.id = 'debug-settings-overlay';

    // Create modal (non-fixed positioning for overlay)
    var modal = document.createElement('div');
    modal.id = 'debug-settings-modal';
    modal.style.position = 'relative';  // relative position for centered overlay content
    modal.style.backgroundColor = 'rgba(30, 30, 30, 0.98)';
    modal.style.borderRadius = '8px';
    modal.style.width = '90%';
    modal.style.maxWidth = '500px';
    modal.style.maxHeight = '90vh';
    modal.style.overflowY = 'auto';
    modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    modal.style.color = '#fff';
    modal.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    // Modal header
    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '20px 24px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';

    var title = document.createElement('h2');
    title.textContent = 'Preferences';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';

    var closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.color = '#fff';
    closeButton.style.fontSize = '24px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.padding = '0';
    closeButton.style.width = '32px';
    closeButton.style.height = '32px';
    closeButton.style.display = 'flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.style.borderRadius = '4px';
    closeButton.style.transition = 'background-color 0.2s';
    closeButton.addEventListener('mouseenter', function() {
        closeButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    closeButton.addEventListener('mouseleave', function() {
        closeButton.style.backgroundColor = 'transparent';
    });
    closeButton.addEventListener('click', function() {
        overlay.remove();
    });

    header.appendChild(title);
    header.appendChild(closeButton);
    modal.appendChild(header);

    // Position option
    var positionContainer = document.createElement('div');
    positionContainer.style.padding = '20px 24px';
    positionContainer.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
    positionContainer.style.display = 'flex';
    positionContainer.style.justifyContent = 'space-between';
    positionContainer.style.alignItems = 'center';
    positionContainer.style.gap = '16px';

    var positionTextContainer = document.createElement('div');
    positionTextContainer.style.flex = '1';

    var positionTitle = document.createElement('div');
    positionTitle.style.fontSize = '14px';
    positionTitle.style.fontWeight = '600';
    positionTitle.style.marginBottom = '4px';
    positionTitle.textContent = 'Position';

    var positionDescription = document.createElement('div');
    positionDescription.style.fontSize = '12px';
    positionDescription.style.color = 'rgba(255, 255, 255, 0.7)';
    positionDescription.textContent = 'Adjust the placement of the panels.';

    positionTextContainer.appendChild(positionTitle);
    positionTextContainer.appendChild(positionDescription);

    var positionSelect = document.createElement('select');
    positionSelect.style.minWidth = '150px';
    positionSelect.style.padding = '8px 12px';
    positionSelect.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    positionSelect.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    positionSelect.style.borderRadius = '4px';
    positionSelect.style.color = '#fff';
    positionSelect.style.fontSize = '14px';
    positionSelect.style.cursor = 'pointer';
    positionSelect.style.outline = 'none';

    var positions = [
        { value: 'bottom-left', label: 'Bottom Left' },
        { value: 'bottom-right', label: 'Bottom Right' },
        { value: 'top-left', label: 'Top Left' },
        { value: 'top-right', label: 'Top Right' }
    ];

    positions.forEach(function(pos) {
        var option = document.createElement('option');
        option.value = pos.value;
        option.textContent = pos.label;
        if (preferences.panelPosition.position === pos.value) {
            option.selected = true;
        }
        positionSelect.appendChild(option);
    });

    positionSelect.addEventListener('change', function() {
        preferences.panelPosition.position = positionSelect.value;
        applyPanelPosition();
        savePreferences();
    });

    positionContainer.appendChild(positionTextContainer);
    positionContainer.appendChild(positionSelect);
    modal.appendChild(positionContainer);

    // Disable instruction
    var disableContainer = document.createElement('div');
    disableContainer.style.padding = '20px 24px';
    disableContainer.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';

    var disableTitle = document.createElement('div');
    disableTitle.style.fontSize = '14px';
    disableTitle.style.fontWeight = '600';
    disableTitle.style.marginBottom = '4px';
    disableTitle.textContent = 'Disable Dev Tools';

    var disableDescription = document.createElement('div');
    disableDescription.style.fontSize = '12px';
    disableDescription.style.color = 'rgba(255, 255, 255, 0.7)';
    disableDescription.style.marginBottom = '8px';
    disableDescription.innerHTML = 'To disable this UI completely, remove the <code style="background: rgba(255, 255, 255, 0.1); padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 11px;">debug.js</code> script from your HTML file.';

    disableContainer.appendChild(disableTitle);
    disableContainer.appendChild(disableDescription);
    modal.appendChild(disableContainer);

    // Hide panels button
    var hideContainer = document.createElement('div');
    hideContainer.style.padding = '20px 24px';
    hideContainer.style.display = 'flex';
    hideContainer.style.justifyContent = 'space-between';
    hideContainer.style.alignItems = 'center';
    hideContainer.style.gap = '16px';

    var hideTextContainer = document.createElement('div');
    hideTextContainer.style.flex = '1';

    var hideTitle = document.createElement('div');
    hideTitle.style.fontSize = '14px';
    hideTitle.style.fontWeight = '600';
    hideTitle.style.marginBottom = '4px';
    hideTitle.textContent = 'Hide Dev Tools for this session';

    var hideDescription = document.createElement('div');
    hideDescription.style.fontSize = '12px';
    hideDescription.style.color = 'rgba(255, 255, 255, 0.7)';
    hideDescription.textContent = 'Hide Dev Tools until you refresh the page.';

    hideTextContainer.appendChild(hideTitle);
    hideTextContainer.appendChild(hideDescription);

    var hideButton = document.createElement('button');
    hideButton.textContent = 'Hide';
    hideButton.style.padding = '8px 16px';
    hideButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    hideButton.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    hideButton.style.borderRadius = '4px';
    hideButton.style.color = '#fff';
    hideButton.style.fontSize = '14px';
    hideButton.style.cursor = 'pointer';
    hideButton.style.transition = 'background-color 0.2s';
    hideButton.style.display = 'flex';
    hideButton.style.alignItems = 'center';
    hideButton.style.gap = '8px';
    hideButton.style.flexShrink = '0';

    hideButton.insertAdjacentHTML('afterbegin', eyeSlashIcon);

    hideButton.addEventListener('mouseenter', function() {
        hideButton.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
    });
    hideButton.addEventListener('mouseleave', function() {
        hideButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });
    hideButton.addEventListener('click', function() {
        hidePanelsForSession();
        overlay.remove();
    });

    hideContainer.appendChild(hideTextContainer);
    hideContainer.appendChild(hideButton);
    modal.appendChild(hideContainer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Mark as selected modal when opened
    selectModal(overlay);

    // Update close button to cleanup from modal stack
    var originalOverlayRemove = overlay.remove.bind(overlay);
    overlay.remove = function() {
        removeModalFromStack(overlay);
        originalOverlayRemove();
    };

    // Mark modal as selected when clicked
    modal.addEventListener('mousedown', function(e) {
        selectModal(overlay);
    });

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// Create and open Send Messages modal
function openSendMessagesModal(uniquePanelId) {
    var debugInfo = roomDebugInfo.get(uniquePanelId);
    if (!debugInfo || !debugInfo.room) {
        console.warn('Room not found for panel:', uniquePanelId);
        return;
    }

    var room = debugInfo.room;
    var messageTypes = debugInfo.messageTypes;

    if (!messageTypes) {
        console.warn('No message types available for this room');
        return;
    }

    // Remove existing modal if present
    var existingModal = document.getElementById('debug-send-messages-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Status dot reference
    var statusDotRef: any = {};
    var updateConnectionStatus: any = null;
    var onLeaveCallbackRef: any = { current: null };

    // Function to update status dot color
    const updateSendMsgStatusDot = () => {
        if (statusDotRef.element) {
            statusDotRef.element.style.backgroundColor = room.connection?.isOpen ? '#22c55e' : '#ef4444';
        }
    };

    // Initial callback
    onLeaveCallbackRef.current = updateSendMsgStatusDot;
    room.onLeave(updateSendMsgStatusDot);

    // Create modal using shared utility
    const modal = createModal({
        id: 'debug-send-messages-modal',
        width: '400px',
        minWidth: '300px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        room: room,
        trackOnLeave: true,
        onLeaveCallback: onLeaveCallbackRef
    });

    // Create header using shared utility
    const headerComponents = createModalHeader({
        title: debugInfo.roomName + ' - Send Message',
        modal: modal,
        statusDot: true,
        statusColor: room.connection?.isOpen ? '#22c55e' : '#ef4444',
        statusDotRef: statusDotRef
    });

    modal.appendChild(headerComponents.header);

    // Make modal draggable
    makeDraggable(modal, headerComponents.header);

    // Update status dot initially
    updateSendMsgStatusDot();

    // Form content container (scrollable)
    var formContainer = document.createElement('div');
    formContainer.style.padding = '8px';
    formContainer.style.overflowY = 'auto';
    formContainer.style.backgroundColor = '#1e1e1e';

    // Message Type Selector
    var typeLabel = document.createElement('label');
    typeLabel.textContent = 'Message Type';
    typeLabel.style.display = 'block';
    typeLabel.style.fontSize = '11px';
    typeLabel.style.fontWeight = '600';
    typeLabel.style.marginBottom = '4px';
    typeLabel.style.color = 'rgba(255, 255, 255, 0.9)';

    var typeSelect = document.createElement('select');
    typeSelect.style.width = '100%';
    typeSelect.style.padding = '6px 8px';
    typeSelect.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    typeSelect.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    typeSelect.style.borderRadius = '4px';
    typeSelect.style.color = '#fff';
    typeSelect.style.fontSize = '12px';
    typeSelect.style.cursor = 'pointer';
    typeSelect.style.outline = 'none';
    typeSelect.style.marginBottom = '12px';

    // Add default option
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a message type';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    typeSelect.appendChild(defaultOption);

    // Add message types
    Object.keys(messageTypes).forEach(function(msgType) {
        var option = document.createElement('option');
        option.value = msgType;
        option.textContent = msgType;
        typeSelect.appendChild(option);
    });

    // Add wildcard option for custom message types
    var wildcardOption = document.createElement('option');
    wildcardOption.value = '*';
    wildcardOption.textContent = '* (Custom)';
    typeSelect.appendChild(wildcardOption);

    formContainer.appendChild(typeLabel);
    formContainer.appendChild(typeSelect);

    // Custom Message Type Input Container (shown when "*" is selected)
    var customTypeContainer = document.createElement('div');
    customTypeContainer.style.display = 'none';
    customTypeContainer.style.marginBottom = '12px';

    var customTypeLabel = document.createElement('label');
    customTypeLabel.textContent = 'Message Type';
    customTypeLabel.style.display = 'block';
    customTypeLabel.style.fontSize = '11px';
    customTypeLabel.style.fontWeight = '600';
    customTypeLabel.style.marginBottom = '4px';
    customTypeLabel.style.color = 'rgba(255, 255, 255, 0.9)';

    var customTypeInput = document.createElement('input');
    customTypeInput.type = 'text';
    customTypeInput.placeholder = 'Enter message type name';
    customTypeInput.style.width = '100%';
    customTypeInput.style.padding = '6px 8px';
    customTypeInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    customTypeInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    customTypeInput.style.borderRadius = '4px';
    customTypeInput.style.color = '#fff';
    customTypeInput.style.fontSize = '11px';
    customTypeInput.style.fontFamily = 'monospace';
    customTypeInput.style.outline = 'none';

    customTypeContainer.appendChild(customTypeLabel);
    customTypeContainer.appendChild(customTypeInput);
    formContainer.appendChild(customTypeContainer);

    // Message Payload Input Container
    var payloadContainer = document.createElement('div');
    payloadContainer.style.display = 'none';
    payloadContainer.style.marginBottom = '12px';

    var payloadLabel = document.createElement('label');
    payloadLabel.textContent = 'Payload';
    payloadLabel.style.display = 'block';
    payloadLabel.style.fontSize = '11px';
    payloadLabel.style.fontWeight = '600';
    payloadLabel.style.marginBottom = '4px';
    payloadLabel.style.color = 'rgba(255, 255, 255, 0.9)';

    var payloadFieldsContainer = document.createElement('div');
    payloadFieldsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    payloadFieldsContainer.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    payloadFieldsContainer.style.borderRadius = '4px';
    payloadFieldsContainer.style.padding = '8px';
    payloadFieldsContainer.style.fontFamily = 'monospace';
    payloadFieldsContainer.style.fontSize = '11px';

    var payloadTextarea = document.createElement('textarea');
    payloadTextarea.style.width = '100%';
    payloadTextarea.style.minHeight = '80px';
    payloadTextarea.style.padding = '6px 8px';
    payloadTextarea.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    payloadTextarea.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    payloadTextarea.style.borderRadius = '4px';
    payloadTextarea.style.color = '#fff';
    payloadTextarea.style.fontSize = '11px';
    payloadTextarea.style.fontFamily = 'monospace';
    payloadTextarea.style.outline = 'none';
    payloadTextarea.style.resize = 'vertical';
    payloadTextarea.placeholder = '{}';
    payloadTextarea.value = '{}';

    payloadContainer.appendChild(payloadLabel);
    payloadContainer.appendChild(payloadFieldsContainer);
    payloadContainer.appendChild(payloadTextarea);
    formContainer.appendChild(payloadContainer);

    // Error message container
    var errorContainer = document.createElement('div');
    errorContainer.style.display = 'none';
    errorContainer.style.padding = '6px 8px';
    errorContainer.style.backgroundColor = 'rgba(220, 38, 38, 0.2)';
    errorContainer.style.border = '1px solid rgba(220, 38, 38, 0.4)';
    errorContainer.style.borderRadius = '4px';
    errorContainer.style.marginBottom = '8px';
    errorContainer.style.fontSize = '11px';
    errorContainer.style.color = '#fca5a5';

    formContainer.appendChild(errorContainer);

    // Variables to store current message type and its schema
    var currentFormInputs: any = {};
    var currentMessageType = '';

    // Update payload fields based on selected message type
    typeSelect.addEventListener('change', function() {
        var selectedType = typeSelect.value;
        currentMessageType = selectedType;

        if (selectedType) {
            // Show/hide custom type input based on selection
            if (selectedType === '*') {
                customTypeContainer.style.display = 'block';
                customTypeInput.focus();
            } else {
                customTypeContainer.style.display = 'none';
            }

            payloadContainer.style.display = 'block';
            errorContainer.style.display = 'none';
            currentFormInputs = {};

            // Clear previous fields
            payloadFieldsContainer.innerHTML = '';

            var schema = messageTypes[selectedType];

            // If schema exists and has properties, create form inputs
            if (schema && schema.properties && Object.keys(schema.properties).length > 0) {
                payloadTextarea.style.display = 'none';
                payloadFieldsContainer.style.display = 'block';

                // Generate form fields based on schema
                Object.keys(schema.properties).forEach(function(fieldName) {
                    var fieldSchema = schema.properties[fieldName];
                    var fieldContainer = document.createElement('div');
                    fieldContainer.style.marginBottom = '8px';

                    var fieldLabel = document.createElement('label');
                    fieldLabel.textContent = fieldName;
                    if (schema.required && schema.required.includes(fieldName)) {
                        fieldLabel.textContent += ' *';
                    }
                    fieldLabel.style.display = 'block';
                    fieldLabel.style.fontSize = '10px';
                    fieldLabel.style.marginBottom = '3px';
                    fieldLabel.style.color = 'rgba(255, 255, 255, 0.8)';

                    var fieldInput;

                    if (fieldSchema.type === 'boolean') {
                        fieldInput = document.createElement('input');
                        fieldInput.type = 'checkbox';
                        fieldInput.style.width = '16px';
                        fieldInput.style.height = '16px';
                        fieldInput.style.cursor = 'pointer';
                    } else if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
                        fieldInput = document.createElement('input');
                        fieldInput.type = 'number';
                        if (fieldSchema.type === 'integer') {
                            fieldInput.step = '1';
                        }
                        fieldInput.style.width = '100%';
                        fieldInput.style.padding = '4px 6px';
                        fieldInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        fieldInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                        fieldInput.style.borderRadius = '3px';
                        fieldInput.style.color = '#fff';
                        fieldInput.style.fontSize = '11px';
                        fieldInput.style.outline = 'none';
                    } else {
                        fieldInput = document.createElement('input');
                        fieldInput.type = 'text';
                        fieldInput.style.width = '100%';
                        fieldInput.style.padding = '4px 6px';
                        fieldInput.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        fieldInput.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                        fieldInput.style.borderRadius = '3px';
                        fieldInput.style.color = '#fff';
                        fieldInput.style.fontSize = '11px';
                        fieldInput.style.outline = 'none';
                    }

                    if (fieldSchema.description) {
                        var fieldDesc = document.createElement('div');
                        fieldDesc.textContent = fieldSchema.description;
                        fieldDesc.style.fontSize = '9px';
                        fieldDesc.style.color = 'rgba(255, 255, 255, 0.5)';
                        fieldDesc.style.marginTop = '2px';
                        fieldContainer.appendChild(fieldLabel);
                        fieldContainer.appendChild(fieldInput);
                        fieldContainer.appendChild(fieldDesc);
                    } else {
                        fieldContainer.appendChild(fieldLabel);
                        fieldContainer.appendChild(fieldInput);
                    }

                    payloadFieldsContainer.appendChild(fieldContainer);
                    currentFormInputs[fieldName] = { input: fieldInput, schema: fieldSchema };
                });
            } else {
                // Use JSON textarea for free-form input (no schema or empty schema)
                payloadTextarea.style.display = 'block';
                payloadFieldsContainer.style.display = 'none';
                payloadTextarea.value = '{}';

                // Update placeholder based on whether schema exists
                if (!schema) {
                    payloadTextarea.placeholder = 'Enter JSON payload (no message format defined)\n\nExample:\n{\n  "key": "value"\n}';
                } else {
                    payloadTextarea.placeholder = '{}';
                }
            }
        } else {
            payloadContainer.style.display = 'none';
        }
    });

    // Send Button
    var sendButton = document.createElement('button');
    sendButton.textContent = 'Send';
    sendButton.style.width = '100%';
    sendButton.style.padding = '8px 12px';
    sendButton.style.backgroundColor = '#8b5cf6';
    sendButton.style.border = 'none';
    sendButton.style.borderRadius = '4px';
    sendButton.style.color = '#fff';
    sendButton.style.fontSize = '12px';
    sendButton.style.fontWeight = '600';
    sendButton.style.cursor = 'pointer';
    sendButton.style.transition = 'background-color 0.2s';

    var isButtonInSuccessState = false;
    var hoverColor = '#7c3aed';
    var normalColor = '#8b5cf6';

    sendButton.addEventListener('mouseenter', function() {
        if (!isButtonInSuccessState && !sendButton.disabled) {
            sendButton.style.backgroundColor = hoverColor;
        }
    });
    sendButton.addEventListener('mouseleave', function() {
        if (!isButtonInSuccessState && !sendButton.disabled) {
            sendButton.style.backgroundColor = normalColor;
        }
    });

    // Update the connection status function to also manage button state
    updateConnectionStatus = function() {
        const isConnected = room.connection?.isOpen;
        if (statusDotRef.element) {
            statusDotRef.element.style.backgroundColor = isConnected ? '#22c55e' : '#ef4444';
        }

        // Update button disabled state
        sendButton.disabled = !isConnected;
        if (!isConnected) {
            sendButton.style.backgroundColor = '#6b7280';
            sendButton.style.cursor = 'not-allowed';
            sendButton.style.opacity = '0.5';
        } else if (!isButtonInSuccessState) {
            sendButton.style.backgroundColor = normalColor;
            sendButton.style.cursor = 'pointer';
            sendButton.style.opacity = '1';
        }
    };

    // Swap out the onLeave callback to use the combined update function
    room.onLeave.remove(onLeaveCallbackRef.current);
    room.onLeave(updateConnectionStatus);
    onLeaveCallbackRef.current = updateConnectionStatus;

    updateConnectionStatus();

    sendButton.addEventListener('click', function() {
        errorContainer.style.display = 'none';

        // Check if room is connected
        if (!room.connection?.isOpen) {
            errorContainer.textContent = 'Cannot send message: Room is not connected';
            errorContainer.style.display = 'block';
            return;
        }

        if (!currentMessageType) {
            errorContainer.textContent = 'Please select a message type';
            errorContainer.style.display = 'block';
            return;
        }

        // Determine actual message type to send
        var actualMessageType = currentMessageType;
        if (currentMessageType === '*') {
            actualMessageType = customTypeInput.value.trim();
            if (!actualMessageType) {
                errorContainer.textContent = 'Please enter a message type name';
                errorContainer.style.display = 'block';
                return;
            }
        }

        try {
            var payload;

            // Build payload from form inputs or textarea
            if (Object.keys(currentFormInputs).length > 0) {
                payload = {};
                var schema = messageTypes[currentMessageType];

                for (var fieldName in currentFormInputs) {
                    var fieldData = currentFormInputs[fieldName];
                    var input = fieldData.input;
                    var fieldSchema = fieldData.schema;
                    var value;

                    if (fieldSchema.type === 'boolean') {
                        value = input.checked;
                    } else if (fieldSchema.type === 'number' || fieldSchema.type === 'integer') {
                        value = input.value ? parseFloat(input.value) : undefined;
                    } else {
                        value = input.value || undefined;
                    }

                    // Only include required fields or fields with values
                    if (value !== undefined || (schema.required && schema.required.includes(fieldName))) {
                        payload[fieldName] = value;
                    }
                }
            } else {
                payload = JSON.parse(payloadTextarea.value);
            }

            // Send the message
            room.send(actualMessageType, payload);

            // Change button to success state
            isButtonInSuccessState = true;
            sendButton.textContent = 'Message sent!';
            sendButton.style.backgroundColor = '#22c55e';
            sendButton.style.cursor = 'default';

            // Restore button after 1.5 seconds
            setTimeout(function() {
                isButtonInSuccessState = false;
                sendButton.textContent = 'Send';
                sendButton.style.backgroundColor = normalColor;
                sendButton.style.cursor = 'pointer';
            }, 800);

        } catch (e) {
            errorContainer.textContent = 'Error: ' + e.message;
            errorContainer.style.display = 'block';
        }
    });

    formContainer.appendChild(sendButton);

    modal.appendChild(formContainer);
    document.body.appendChild(modal);
}

// Create and open State Inspector modal
function openStateInspectorModal(uniquePanelId) {
    var debugInfo = roomDebugInfo.get(uniquePanelId);
    if (!debugInfo || !debugInfo.room) {
        console.warn('Room not found for panel:', uniquePanelId);
        return;
    }

    var room = debugInfo.room;

    // Remove existing modal if present
    var existingModal = document.getElementById('debug-state-inspector-modal');
    if (existingModal) {
        existingModal.remove();
    }

    // Load saved position and size from localStorage
    var savedStateInspectorPrefs = null;
    try {
        var saved = localStorage.getItem('colyseus-state-inspector-preferences');
        if (saved) {
            savedStateInspectorPrefs = JSON.parse(saved);
        }
    } catch (e) {
        // Ignore localStorage errors
    }

    // Default values
    var defaultWidth = 600;
    var defaultHeight = 500;
    var defaultLeft = '50%';
    var defaultTop = '50%';
    var defaultTransform = 'translate(-50%, -50%)';

    // Use saved preferences if available
    if (savedStateInspectorPrefs) {
        if (savedStateInspectorPrefs.width && savedStateInspectorPrefs.width >= 300) {
            defaultWidth = savedStateInspectorPrefs.width;
        }
        if (savedStateInspectorPrefs.height && savedStateInspectorPrefs.height >= 200) {
            defaultHeight = savedStateInspectorPrefs.height;
        }
        if (savedStateInspectorPrefs.left !== undefined && savedStateInspectorPrefs.top !== undefined) {
            // Constrain position to window boundaries
            var maxLeft = window.innerWidth - defaultWidth;
            var maxTop = window.innerHeight - defaultHeight;

            var constrainedLeft = Math.max(0, Math.min(savedStateInspectorPrefs.left, maxLeft));
            var constrainedTop = Math.max(0, Math.min(savedStateInspectorPrefs.top, maxTop));

            defaultLeft = constrainedLeft + 'px';
            defaultTop = constrainedTop + 'px';
            defaultTransform = 'none';
        }
    }

    // Function to save state inspector preferences
    function saveStateInspectorPreferences() {
        try {
            var rect = modal.getBoundingClientRect();
            var prefs = {
                width: rect.width,
                height: rect.height,
                left: rect.left,
                top: rect.top
            };
            localStorage.setItem('colyseus-state-inspector-preferences', JSON.stringify(prefs));
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    // Status dot reference
    var statusDotRef: any = {};

    // Function to update status dot color
    const updateStateViewerStatusDot = () => {
        if (statusDotRef.element) {
            statusDotRef.element.style.backgroundColor = room.connection?.isOpen ? '#22c55e' : '#ef4444';
        }
    };

    // Register the onLeave callback
    room.onLeave(updateStateViewerStatusDot);

    // Create modal using shared utility with automatic onLeave tracking
    const modal = createModal({
        id: 'debug-state-inspector-modal',
        width: defaultWidth + 'px',
        height: defaultHeight + 'px',
        minWidth: '300px',
        minHeight: '200px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        top: defaultTop,
        left: defaultLeft,
        transform: defaultTransform,
        room: room,
        trackOnLeave: true,
        onLeaveCallback: updateStateViewerStatusDot
    });

    // Create header using shared utility
    const headerComponents = createModalHeader({
        title: `${debugInfo.roomName} - State Viewer`,
        modal: modal,
        statusDot: true,
        statusColor: room.connection?.isOpen ? '#22c55e' : '#ef4444',
        statusDotRef: statusDotRef
    });
    const header = headerComponents.header;
    const closeButton = headerComponents.closeButton;

    modal.appendChild(header);

    // Update status dot initially
    updateStateViewerStatusDot();

    // State content container
    var contentContainer = document.createElement('div');
    contentContainer.style.padding = '8px';
    contentContainer.style.overflowY = 'auto';
    contentContainer.style.flex = '1';
    contentContainer.style.minHeight = '0';
    contentContainer.style.backgroundColor = '#1e1e1e';
    contentContainer.id = 'debug-state-content';

    // Single event listener for all expand buttons (event delegation)
    contentContainer.addEventListener('click', function(e: MouseEvent) {
        var expandButton = (e.target as HTMLElement).closest('[data-expand-button]');
        if (expandButton) {
            e.stopPropagation();
            toggleExpand(expandButton);
        }
    });

    // // Counter for unique IDs
    // var stateNodeCounter = 0;

    // Track expanded paths across re-renders
    var expandedPaths = new Set();

    // Helper function to escape HTML
    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Helper function to check if a value is expandable (object, array, or collection)
    function isExpandable(value) {
        if (value === null || value === undefined) {
            return false;
        }
        var valueType = typeof value;
        var isObject = valueType === 'object' && !(value instanceof Array);
        var hasForEach = valueType === 'object' && typeof value.forEach === 'function';
        var isArray = value instanceof Array;
        return isObject || isArray || hasForEach;
    }

    // Helper function to get label color based on field name
    function getLabelColor(fieldName) {
        return typeof fieldName === 'string' && fieldName.startsWith('"') ? '#CE9178' : '#DCDCAA';
    }

    // Helper function to get display state for expandable nodes
    function getDisplayState(depth, isPathExpanded) {
        var isRoot = depth === 0;
        return {
            isRoot: isRoot,
            initialDisplay: isRoot ? 'block' : (isPathExpanded ? 'block' : 'none'),
            initialIcon: (isRoot || isPathExpanded) ? '▼' : '▶',
            rootClass: isRoot ? ' data-root-node="true"' : ''
        };
    }

    // Helper function to get refId display string
    function getRefIdDisplay(refId) {
        return refId !== null && refId !== undefined ? '<span style="color: #909090; font-size: 11px; margin-left: 4px;">(ref: ' + refId + ')</span>' : '';
    }

    // Helper function to render expand button HTML
    function renderExpandButton(displayState, displayLabel, refIdDisplay, size) {
        var html = '<div data-expand-button' + displayState.rootClass + ' style="display: flex; align-items: center; cursor: ' + (displayState.isRoot ? 'default' : 'pointer') + '; user-select: none; margin: 0; padding: 1px 0;" onmouseover="' + (displayState.isRoot ? '' : 'this.style.backgroundColor=\'rgba(255,255,255,0.05)\'') + '" onmouseout="' + (displayState.isRoot ? '' : 'this.style.backgroundColor=\'transparent\'') + '">';
        html += '<span data-expand-icon style="margin-right: 4px; color: #858585; font-size: 10px; width: 10px; display: inline-block; text-align: center; user-select: none;">' + displayState.initialIcon + '</span>';
        if (displayLabel) {
            html += '<span style="color: ' + getLabelColor(displayLabel) + ';">' + escapeHtml(String(displayLabel)) + '</span>';
        }
        if (size !== null && size !== undefined && size !== '?') {
            // ×
            html += ' <span style="color: #858585;">(' + size + ') </span>';
        }
        html += refIdDisplay;
        html += '</div>';
        return html;
    }

    // Helper function to render a key-value pair
    function renderKeyValue(key, value, depth, currentPath, keyDisplay, isKeyString) {
        if (isExpandable(value)) {
            // For expandable values, renderState handles its own container with proper indentation
            // Pass the fieldName so it displays the key as the label
            if (keyDisplay !== null) {
                return renderState(value, depth, String(key), currentPath, keyDisplay);
            } else {
                return renderState(value, depth, String(key), currentPath);
            }
        } else {
            // For primitive values, wrap in a div with key-value formatting
            // Add padding-left to align with expandable items (icon width 10px + margin-right 4px = 14px)
            var indent = depth * 6;
            var html = '<div style="margin-left: ' + indent + 'px; padding-left: 14px;">';
            if (keyDisplay !== null) {
                var keyColor = isKeyString ? '#CE9178' : '#DCDCAA';
                html += '<span style="color: ' + keyColor + ';">' + (isKeyString ? '"' + escapeHtml(String(keyDisplay)) + '"' : escapeHtml(String(keyDisplay))) + '</span><span style="color: #858585;">: </span>';
            } else {
                html += '<span style="color: #DCDCAA;">' + escapeHtml(String(key)) + '</span><span style="color: #858585;">: </span>';
            }
            html += renderState(value, depth + 1, String(key), currentPath);
            html += '</div>';
            return html;
        }
    }

    // Function to render state recursively
    function renderState(
        obj: any,
        depth: number = 0,
        parentKey: string = '',
        path: string = '',
        fieldName: string = null
    ) {
        var maxDepth = 10;
        if (depth > maxDepth) {
            return '<span style="color: #858585; font-style: italic;">[Max depth reached]</span>';
        }

        if (obj === null) {
            return '<span style="color: #858585;">null</span>';
        }

        if (obj === undefined) {
            return '<span style="color: #858585;">undefined</span>';
        }

        var type = typeof obj;
        var indent = depth * 6;
        var refId = obj["~refId"];
        var nodeId = 'state-node-' + refId;
        var currentPath = path ? path + '.' + (parentKey || '') : (parentKey || 'root');
        var isPathExpanded = expandedPaths.has(currentPath);
        var refIdDisplay = getRefIdDisplay(refId);

        if (type === 'string') {
            return '<span style="color: #CE9178;">"' + escapeHtml(String(obj)) + '"</span>';
        }

        if (type === 'number') {
            return '<span style="color: #B5CEA8;">' + obj + '</span>';
        }

        if (type === 'boolean') {
            return '<span style="color: #569CD6;">' + obj + '</span>';
        }

        // Check if object has forEach method
        var hasForEach = typeof obj.forEach === 'function';
        var collectionSize = (hasForEach) && (obj.size || obj.length) || null;

        if (hasForEach) {
            var size = (collectionSize !== null ? collectionSize : '?');
            var contentId = nodeId + '-content';
            var displayState = getDisplayState(depth, isPathExpanded);
            var displayLabel = fieldName !== null ? fieldName : (displayState.isRoot ? 'State' : '');

            var html = '<div style="margin-left: ' + indent + 'px;" data-path="' + escapeHtml(currentPath) + '">';
            html += renderExpandButton(displayState, displayLabel, refIdDisplay, size);
            html += '<div id="' + contentId + '" style="display: ' + displayState.initialDisplay + ';">';

            // Handle forEach collections (Map, Set, etc.)
            var isSet = obj instanceof Set || (obj.constructor && obj.constructor.name === 'Set');
            try {
                obj.forEach(function (value, key) {
                    if (isSet) {
                        // For Sets, forEach passes (value, value, set), so we only use the first parameter
                        html += renderState(value, depth + 1, String(key), currentPath);
                    } else {
                        // For Maps, format key and use renderKeyValue to handle expandable values and proper formatting
                        var isKeyNumber = typeof key === 'number';
                        var keyStr = isKeyNumber ? '[' + String(key) + ']' : String(key);
                        html += renderKeyValue(key, value, depth + 1, currentPath, keyStr, typeof key === 'string');
                    }
                });
            } catch (e) {
                var errorIndent = (depth + 1) * 6;
                html += '<div style="margin-left: ' + errorIndent + 'px; color: #e74856;">Error iterating: ' + escapeHtml(e.message) + '</div>';
            }

            html += '</div>';
            html += '</div>';
            return html;
        }

        if (type === 'object') {
            var keys = Object.keys(obj);
            var contentId = nodeId + '-content';
            var displayState = getDisplayState(depth, isPathExpanded);
            var displayLabel = fieldName !== null ? fieldName : (displayState.isRoot ? 'state' : '');

            var html = '<div style="margin-left: ' + indent + 'px;" data-path="' + escapeHtml(currentPath) + '">';

            if (keys.length === 0) {
                if (displayLabel) {
                    html += '<span style="color: ' + getLabelColor(displayLabel) + ';">' + escapeHtml(String(displayLabel)) + '</span><span style="color: #858585;"> {}</span>' + refIdDisplay;
                } else {
                    html += '<span style="color: #858585;">{}</span>' + refIdDisplay;
                }
            } else {
                html += renderExpandButton(displayState, displayLabel, refIdDisplay, null);
                html += '<div id="' + contentId + '" style="display: ' + displayState.initialDisplay + ';">';

                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (key === "~refId") continue;// skip refId
                    html += renderKeyValue(key, obj[key], depth + 1, currentPath, key, false);
                }

                html += '</div>';
            }

            html += '</div>';
            return html;
        }

        return '<span style="color: #858585;">' + escapeHtml(String(obj)) + '</span>';
    }

    // Function to toggle expand/collapse
    function toggleExpand(expandButton) {
        // Don't allow collapsing root node
        var content = expandButton.nextElementSibling;
        var icon = expandButton.querySelector('[data-expand-icon]');
        if (content && content.style) {
            var isHidden = content.style.display === 'none';
            content.style.display = isHidden ? 'block' : 'none';
            if (icon) {
                icon.textContent = isHidden ? '▼' : '▶';
            }

            // Track expanded state by path
            var pathElement = expandButton.closest('[data-path]');
            if (pathElement) {
                var path = pathElement.getAttribute('data-path');
                if (isHidden) {
                    expandedPaths.add(path);
                } else {
                    expandedPaths.delete(path);
                }
            }
        }
    }

    // Function to update state display
    function updateStateDisplay() {
        try {
            // Save currently expanded paths before clearing
            var currentExpandedPaths = new Set();
            var existingExpandButtons = contentContainer.querySelectorAll('[data-expand-button]');
            for (var i = 0; i < existingExpandButtons.length; i++) {
                var button = existingExpandButtons[i];
                var pathElement = button.closest('[data-path]');
                if (pathElement) {
                    var path = pathElement.getAttribute('data-path');
                    var content = button.nextElementSibling as HTMLElement;
                    if (content && content.style && content.style.display !== 'none') {
                        currentExpandedPaths.add(path);
                    }
                }
            }

            // Merge with previously tracked expanded paths
            // Keep paths that were expanded before, or are currently expanded
            var pathsToKeep = new Set();
            expandedPaths.forEach(function(path) {
                pathsToKeep.add(path);
            });
            currentExpandedPaths.forEach(function(path) {
                pathsToKeep.add(path);
            });
            expandedPaths = pathsToKeep;

            // stateNodeCounter = 0; // Reset counter for new render
            var state = room.state || {};
            contentContainer.innerHTML = '<div style="font-family: \'Consolas\', \'Monaco\', \'Courier New\', monospace; font-size: 12px; line-height: 1.5; color: #d4d4d4; padding: 8px;">' + renderState(state) + '</div>';

            // Event delegation: single click listener handles all expand buttons
        } catch (e) {
            contentContainer.innerHTML = '<div style="color: #e74856; padding: 20px;">Error accessing room state: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // Throttle function to prevent excessive re-renders
    // TODO: prevent re-renders of unchanged refIds instead of just throttling
    function throttle(func, wait) {
        var timeout;
        var previous = 0;
        return function executedFunction() {
            var context = this;
            var args = arguments;
            var now = Date.now();
            var remaining = wait - (now - previous);

            if (remaining <= 0 || remaining > wait) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                previous = now;
                func.apply(context, args);
            } else if (!timeout) {
                timeout = setTimeout(function() {
                    previous = Date.now();
                    timeout = null;
                    func.apply(context, args);
                }, remaining);
            }
        };
    }

    // Create throttled version of updateStateDisplay
    var throttledUpdateStateDisplay = throttle(updateStateDisplay, 200);

    // Initial render - root is always expanded
    expandedPaths.add('root');
    updateStateDisplay();

    // Update state when it changes
    const originalTriggerChanges = room.serializer.decoder.triggerChanges;
    room.serializer.decoder.triggerChanges = function(changes) {
        originalTriggerChanges?.apply(this, arguments);
        throttledUpdateStateDisplay();
        /**
         * TODO: keep track of which refIds have changed and only re-render those
         */
    }

    modal.appendChild(contentContainer);
    document.body.appendChild(modal);

    // Drag and resize state variables
    var isDragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var modalStartX = 0;
    var modalStartY = 0;
    var isResizing = false;
    var resizeHandle = null;
    var resizeStartX = 0;
    var resizeStartY = 0;
    var resizeStartWidth = 0;
    var resizeStartHeight = 0;
    var resizeStartLeft = 0;
    var resizeStartTop = 0;

    header.addEventListener('mousedown', function(e) {
        const target = e.target as HTMLElement;
        // Don't drag if clicking on a resize handle
        if (target.classList && target.classList.contains('resize-handle')) {
            return;
        }
        if (target === closeButton || closeButton.contains(target)) {
            return; // Don't drag when clicking close button
        }
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        var rect = modal.getBoundingClientRect();
        modalStartX = rect.left;
        modalStartY = rect.top;
        modal.style.cursor = 'move';
        e.preventDefault();
    });

    var handleMouseMove = function(e) {
        if (isResizing && resizeHandle) {
            // Handle resize
            var deltaX = e.clientX - resizeStartX;
            var deltaY = e.clientY - resizeStartY;
            var newWidth = resizeStartWidth;
            var newHeight = resizeStartHeight;
            var newLeft = resizeStartLeft;
            var newTop = resizeStartTop;

            if (resizeHandle.includes('e')) {
                newWidth = resizeStartWidth + deltaX;
            }
            if (resizeHandle.includes('w')) {
                newWidth = resizeStartWidth - deltaX;
                newLeft = resizeStartLeft + deltaX;
            }
            if (resizeHandle.includes('s')) {
                newHeight = resizeStartHeight + deltaY;
            }
            if (resizeHandle.includes('n')) {
                newHeight = resizeStartHeight - deltaY;
                newTop = resizeStartTop + deltaY;
            }

            // Apply constraints
            newWidth = Math.max(parseInt(modal.style.minWidth) || 300, Math.min(newWidth, window.innerWidth - newLeft));
            newHeight = Math.max(parseInt(modal.style.minHeight) || 200, Math.min(newHeight, window.innerHeight - newTop));

            modal.style.width = newWidth + 'px';
            modal.style.height = newHeight + 'px';
            modal.style.left = newLeft + 'px';
            modal.style.top = newTop + 'px';
            modal.style.transform = 'none';
        } else if (isDragging) {
            // Handle drag
            var deltaX = e.clientX - dragStartX;
            var deltaY = e.clientY - dragStartY;
            var newX = modalStartX + deltaX;
            var newY = modalStartY + deltaY;

            // Constrain to viewport
            var maxX = window.innerWidth - modal.offsetWidth;
            var maxY = window.innerHeight - modal.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            modal.style.left = newX + 'px';
            modal.style.top = newY + 'px';
            modal.style.transform = 'none';
        }
    };

    document.addEventListener('mousemove', handleMouseMove);

    var handleMouseUp = function() {
        if (isDragging) {
            isDragging = false;
            modal.style.cursor = '';
            saveStateInspectorPreferences();
        }
        if (isResizing) {
            isResizing = false;
            resizeHandle = null;
            saveStateInspectorPreferences();
        }
    };

    document.addEventListener('mouseup', handleMouseUp);

    // Resize functionality
    var resizeHandleSize = 8;
    var cornerHandleSize = 12; // Larger handles for corners to make them easier to grab

    // Create edge handles first, then corner handles (so corners are on top)
    var edgeHandles = ['n', 's', 'e', 'w'];
    var cornerHandles = ['nw', 'ne', 'sw', 'se'];

    // Create edge handles (leaving space for corners)
    edgeHandles.forEach(function(handle) {
        var handleEl = document.createElement('div');
        handleEl.className = 'resize-handle resize-' + handle;
        handleEl.style.position = 'absolute';
        handleEl.style.backgroundColor = 'transparent';
        handleEl.style.zIndex = '10000';
        handleEl.style.pointerEvents = 'auto';

        if (handle === 'n' || handle === 's') {
            handleEl.style.height = resizeHandleSize + 'px';
            handleEl.style.left = cornerHandleSize + 'px';
            handleEl.style.right = cornerHandleSize + 'px';
            if (handle === 'n') {
                handleEl.style.top = '0';
                handleEl.style.cursor = 'n-resize';
            } else {
                handleEl.style.bottom = '0';
                handleEl.style.cursor = 's-resize';
            }
        } else {
            handleEl.style.width = resizeHandleSize + 'px';
            handleEl.style.top = cornerHandleSize + 'px';
            handleEl.style.bottom = cornerHandleSize + 'px';
            if (handle === 'e') {
                handleEl.style.right = '0';
                handleEl.style.cursor = 'e-resize';
            } else {
                handleEl.style.left = '0';
                handleEl.style.cursor = 'w-resize';
            }
        }

        handleEl.addEventListener('mousedown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            isResizing = true;
            resizeHandle = handle;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            var rect = modal.getBoundingClientRect();
            resizeStartWidth = rect.width;
            resizeStartHeight = rect.height;
            resizeStartLeft = rect.left;
            resizeStartTop = rect.top;
        });

        modal.appendChild(handleEl);
    });

    // Create corner handles (higher z-index so they're on top)
    cornerHandles.forEach(function(handle) {
        var handleEl = document.createElement('div');
        handleEl.className = 'resize-handle resize-' + handle;
        handleEl.style.position = 'absolute';
        handleEl.style.backgroundColor = 'transparent';
        handleEl.style.zIndex = '10002';
        handleEl.style.pointerEvents = 'auto';
        handleEl.style.width = cornerHandleSize + 'px';
        handleEl.style.height = cornerHandleSize + 'px';

        if (handle === 'nw') {
            handleEl.style.top = '0';
            handleEl.style.left = '0';
            handleEl.style.cursor = 'nw-resize';
        } else if (handle === 'ne') {
            handleEl.style.top = '0';
            handleEl.style.right = '0';
            handleEl.style.cursor = 'ne-resize';
        } else if (handle === 'sw') {
            handleEl.style.bottom = '0';
            handleEl.style.left = '0';
            handleEl.style.cursor = 'sw-resize';
        } else if (handle === 'se') {
            handleEl.style.bottom = '0';
            handleEl.style.right = '0';
            handleEl.style.cursor = 'se-resize';
        }

        handleEl.addEventListener('mousedown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            isResizing = true;
            resizeHandle = handle;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            var rect = modal.getBoundingClientRect();
            resizeStartWidth = rect.width;
            resizeStartHeight = rect.height;
            resizeStartLeft = rect.left;
            resizeStartTop = rect.top;
        });

        modal.appendChild(handleEl);
    });


    // Remove state change listener when modal is closed
    var originalRemove = modal.remove;
    modal.remove = function() {
        // Restore original trigger changes
        room.serializer.decoder.triggerChanges = originalTriggerChanges;
        originalRemove.call(this);
    };
}

// Apply panel position based on current setting
function applyPanelPosition() {
    var logoContainer = document.getElementById('debug-logo-container');
    var menu = document.getElementById('debug-menu');
    var panels = document.querySelectorAll('[id^="debug-panel-"]');

    var positions = {
        'bottom-right': { bottom: '14px', right: '14px', top: 'auto', left: 'auto' },
        'bottom-left': { bottom: '14px', left: '14px', top: 'auto', right: 'auto' },
        'top-left': { top: '14px', left: '14px', bottom: 'auto', right: 'auto' },
        'top-right': { top: '14px', right: '14px', bottom: 'auto', left: 'auto' }
    };

    var pos = positions[preferences.panelPosition.position] || positions['bottom-right'];

    // Update logo container
    if (logoContainer) {
        logoContainer.style.bottom = pos.bottom;
        logoContainer.style.right = pos.right;
        logoContainer.style.top = pos.top;
        logoContainer.style.left = pos.left;
    }

    // Update menu position
    if (menu) {
        if (preferences.panelPosition.position.startsWith('bottom')) {
            menu.style.bottom = '60px';
            menu.style.top = 'auto';
        } else {
            // For top positions, menu appears below the logo
            menu.style.top = '60px';
            menu.style.bottom = 'auto';
        }
        menu.style.right = pos.right;
        menu.style.left = pos.left;
    }

    // Update panels
    repositionDebugPanels();
}

// Hide panels for this session
function hidePanelsForSession() {
    panelsHidden = true;
    savePreferences(); // Save the hidden state

    var logoContainer = document.getElementById('debug-logo-container');
    var menu = document.getElementById('debug-menu');
    var panels = document.querySelectorAll('[id^="debug-panel-"]') as NodeListOf<HTMLElement>;

    if (logoContainer) {
        logoContainer.style.display = 'none';
    }
    if (menu) {
        menu.style.display = 'none';
    }
    panels.forEach(function(panel) {
        panel.style.display = 'none';
    });
}

// Helper function to format bytes
function formatBytes(bytes) {
    if (!bytes) {
        return '0 B';
    } else if (bytes < 1) {
        bytes = 1; // avoid visual glitches
    }
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return (Math.round(bytes) / Math.pow(k, i)).toFixed(1)  + ' ' + sizes[i];
}

// Helper function to create debug panel for a room
function createDebugPanel(uniquePanelId, debugInfo) {
    // Check if panel already exists
    var existingPanel = document.getElementById('debug-panel-' + uniquePanelId);
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
    panel.style.display = panelsHidden ? 'none' : 'block';

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
    if (!document.getElementById('debug-pulse-animation')) {
        var style = document.createElement('style');
        style.id = 'debug-pulse-animation';
        style.textContent = '@keyframes debug-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }';
        document.head.appendChild(style);
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

    // Prepend panel to body so new panels appear first
    if (document.body.firstChild) {
        document.body.insertBefore(panel, document.body.firstChild);
    } else {
        document.body.appendChild(panel);
    }

    return panel;
}

// Reposition all debug panels to stack vertically
function repositionDebugPanels() {
    if (panelsHidden) return;

    var panels = Array.from(document.querySelectorAll('[id^="debug-panel-"]') as NodeListOf<HTMLElement>)
        .filter(function(panel: HTMLElement) { return panel.style.display !== 'none'; })
        .reverse(); // Reverse to get oldest first (since new panels are prepended)

    // Calculate logoIcon container width: 22px width + 10px padding on each side = 42px
    // Add 6px margin to prevent overlap
    var logoIconOffset = 42 + 6;

    var positions = {
        'bottom-right': {
            start: { bottom: '14px', right: '14px', top: 'auto', left: 'auto' },
            offset: function(panel, currentRight) { return { right: currentRight + 'px', left: 'auto' }; }
        },
        'bottom-left': {
            start: { bottom: '14px', left: '14px', top: 'auto', right: 'auto' },
            offset: function(panel, currentLeft) { return { left: currentLeft + 'px', right: 'auto' }; }
        },
        'top-left': {
            start: { top: '14px', left: '14px', bottom: 'auto', right: 'auto' },
            offset: function(panel, currentLeft) { return { left: currentLeft + 'px', right: 'auto' }; }
        },
        'top-right': {
            start: { top: '14px', right: '14px', bottom: 'auto', left: 'auto' },
            offset: function(panel, currentRight) { return { right: currentRight + 'px', left: 'auto' }; }
        }
    };

    var pos = positions[preferences.panelPosition.position] || positions['bottom-right'];
    var baseOffset = 14 + logoIconOffset;
    var currentOffset = baseOffset;

    panels.forEach(function(panel) {
        // Set base position
        Object.keys(pos.start).forEach(function(key) {
            panel.style[key] = pos.start[key];
        });

        // Apply offset
        var offset = pos.offset(panel, currentOffset);
        Object.keys(offset).forEach(function(key) {
            panel.style[key] = offset[key];
        });

        currentOffset += panel.offsetWidth + 6;
    });
}

// Update debug panel content
function updateDebugPanel(uniquePanelId, debugInfo) {
    var contentId = 'debug-content-' + uniquePanelId;
    var panelId = 'debug-panel-' + uniquePanelId;
    var titleId = 'debug-title-' + uniquePanelId;
    var content = document.getElementById(contentId);
    var panel = document.getElementById(panelId);
    var title = document.getElementById(titleId);

    if (!content || !panel) {
        // Only create if panel doesn't exist
        if (!panel) {
            createDebugPanel(uniquePanelId, debugInfo);
            content = document.getElementById(contentId);
            title = document.getElementById(titleId);
            repositionDebugPanels();
        } else {
            content = document.getElementById(contentId);
            title = document.getElementById(titleId);
        }
    }

    // Update title with room name only (roomId and sessionId are in tooltip)
    var titleTextEl = document.getElementById('debug-title-text-' + uniquePanelId);
    var roomNameEl = titleTextEl?.querySelector('.debug-room-name');
    if (roomNameEl) roomNameEl.textContent = debugInfo.roomName;
    document.getElementById('debug-tooltip-' + uniquePanelId).innerHTML = '<div><strong>Room ID:</strong> ' + debugInfo.roomId + '</div><div><strong>Session ID:</strong> ' + debugInfo.sessionId + '</div>';

    // Update ping in header
    var pingDisplay = debugInfo.pingMs !== null ? debugInfo.pingMs + 'ms' : '--';
    var pingColor = debugInfo.pingMs !== null ? (debugInfo.pingMs < 100 ? '#22c55e' : debugInfo.pingMs < 200 ? '#eab308' : '#ef4444') : '#888';
    var pingElement = document.getElementById('debug-ping-' + uniquePanelId);
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
function drawGraph(canvasId, data, color) {
    var canvas = document.getElementById(canvasId) as HTMLCanvasElement;
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
function calculateRates(debugInfo) {
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

        // Generate unique panel ID: use sessionId if available, otherwise use roomId + timestamp
        const uniquePanelId = sessionId && sessionId !== 'N/A' && sessionId !== ''
            ? sessionId
            : roomId + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

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
            var messageBtnElement = document.getElementById('debug-message-btn-' + uniquePanelId);
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
                return originalOnMessage.apply(this, arguments);
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
            var panel = document.getElementById('debug-panel-' + uniquePanelId);
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

    // Store original methods that return rooms
    var originalJoinOrCreate = Client.prototype.joinOrCreate;
    var originalJoin = Client.prototype.join;
    var originalCreate = Client.prototype.create;
    var originalReconnect = Client.prototype.reconnect;

    // Patch joinOrCreate
    Client.prototype.joinOrCreate = function() {
        var promise = originalJoinOrCreate.apply(this, arguments);
        return promise.then((room) => patchRoom(room));
    };

    // Patch join
    Client.prototype.join = function() {
        var promise = originalJoin.apply(this, arguments);
        return promise.then((room) => patchRoom(room));
    };

    // Patch create
    Client.prototype.create = function() {
        var promise = originalCreate.apply(this, arguments);
        return promise.then((room) => patchRoom(room));
    };

    // Patch reconnect
    if (originalReconnect) {
        Client.prototype.reconnect = function() {
            var promise = originalReconnect.apply(this, arguments);
            return promise.then((room) => patchRoom(room));
        };
    }
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