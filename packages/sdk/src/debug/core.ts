// Store debug info per room
export const roomDebugInfo = new Map();


// Preferences state
export const preferences = {
    maxLatency: 350, // milliseconds
    latencySimulation: {
        enabled: false,
        delay: 0, // milliseconds (one-way inbound; outbound uses half)
        jitter: 0 // milliseconds — per-message delay varies by ±jitter (order-preserving)
    },
    panelPosition: {
        position: 'top-right' // 'bottom-right', 'bottom-left', 'top-left', 'top-right'
    }
};


// Load preferences from localStorage (hidden state from sessionStorage)
export function loadPreferences() {
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

        // Load jitter
        if (prefs.jitter !== undefined && prefs.jitter !== null) {
            const jitterValue = parseInt(prefs.jitter, 10);
            if (!isNaN(jitterValue) && jitterValue >= 0) {
                preferences.latencySimulation.jitter = jitterValue;
                if (jitterValue > 0) preferences.latencySimulation.enabled = true;
            }
        }

        // Load hidden state from sessionStorage
        if (sessionStorage.getItem('colyseus-debug-hidden') === 'true') {
            panelsHidden = true;
        }
    } catch (e) {
        // Storage might not be available or JSON parse failed, ignore
    }
}


// Save preferences to localStorage (hidden state to sessionStorage)
export function savePreferences() {
    try {
        localStorage.setItem('colyseus-debug-preferences', JSON.stringify({
            position: preferences.panelPosition.position,
            latency: preferences.latencySimulation.delay,
            jitter: preferences.latencySimulation.jitter,
        }));
        sessionStorage.setItem('colyseus-debug-hidden', panelsHidden ? 'true' : 'false');
    } catch (e) {
        // Storage might not be available, ignore
    }
}


// Panel visibility state
let panelsHidden = false;


// Shadow DOM root — isolates all debug UI from page-level CSS.
// Every SDK element is appended here so page rules like `canvas { width: 100vw }`
// can't reach (or stretch) the debug panel's sparklines, logo, menu, or modals.
let _debugShadowRoot: ShadowRoot | null = null;

export function getDebugRoot(): ShadowRoot {
    if (_debugShadowRoot) return _debugShadowRoot;
    const host = document.createElement('div');
    host.id = 'colyseus-debug-shadow-host';
    _debugShadowRoot = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    return _debugShadowRoot;
}


// Function to get border color based on latency simulation value
export function getBorderColor(latencyValue, opacity) {
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


// Apply panel position based on current setting
export function applyPanelPosition() {
    var root = getDebugRoot();
    var logoContainer = root.getElementById('debug-logo-container');
    var menu = root.getElementById('debug-menu');
    var panels = root.querySelectorAll('[id^="debug-panel-"]');

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
export function hidePanelsForSession() {
    panelsHidden = true;
    savePreferences(); // Save the hidden state

    var root = getDebugRoot();
    var logoContainer = root.getElementById('debug-logo-container');
    var menu = root.getElementById('debug-menu');
    var panels = root.querySelectorAll('[id^="debug-panel-"]') as NodeListOf<HTMLElement>;
    var predictContainer = root.getElementById('colyseus-debug-predict-container');

    if (logoContainer) {
        logoContainer.style.display = 'none';
    }
    if (menu) {
        menu.style.display = 'none';
    }
    panels.forEach(function(panel) {
        panel.style.display = 'none';
    });
    // Predict panel is a sibling overlay (own id) — hide it alongside the rest.
    if (predictContainer) {
        predictContainer.style.display = 'none';
    }
}


// Helper function to format bytes
export function formatBytes(bytes) {
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


// Reposition all debug panels to stack vertically
export function repositionDebugPanels() {
    if (panelsHidden) return;

    var panels = Array.from(getDebugRoot().querySelectorAll('[id^="debug-panel-"]') as NodeListOf<HTMLElement>)
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

export function isPanelsHidden(): boolean { return panelsHidden; }
