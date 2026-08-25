/**
 * The logo's menu: host status, network simulation, auth token, panel position,
 * and the session-hide switch.
 *
 * A corner-anchored dropdown on a wide screen; on a phone it takes over the room
 * drawer's box (see `applyMenuPosition` in core.ts), which is why the two never
 * appear together. The logo itself is built by `panel.ts`; this module owns what
 * happens when you press it — tap toggles the drawer, long press opens the menu.
 */
import { copyIcon, eyeSlashIcon, keyIcon, networkIcon, settingsIcon, sizedIcon } from "./icons.ts";
import { authInstances, getBorderColor, getDebugRoot, hidePanelsForSession, isCompactRevealed, latencyRamp, preferences, roomDebugInfo, savePreferences, setCompactMenuOpen, setCompactRevealed } from "./core.ts";
import { horizontalEdge, verticalEdge } from "./geometry.ts";
import { isCompact, reflow } from "./layout.ts";
import { applySegmentedState, bindSegmentedHover } from "./tokens.ts";


// Long enough not to fire on a hurried tap, short enough not to feel stuck.
const LONG_PRESS_MS = 450;
// Movement beyond this cancels the press — a finger is never perfectly still.
const PRESS_SLOP = 10;


export function createMenu(logoContainer: HTMLElement) {
    var menu = document.createElement('div');
    menu.id = 'debug-menu';
    menu.className = 'cds-surface cds-scroll';
    menu.style.position = 'fixed';
    // Geometry (corner, min-width, border-radius, max-height, overflow) is owned by
    // applyMenuPosition — it differs between the dropdown and the compact sheet.
    // border-box so its 1px border doesn't push it 2px wider than the drawer it
    // replaces, whose max-width it shares.
    menu.style.boxSizing = 'border-box';
    menu.style.backgroundColor = 'rgba(18, 18, 20, 0.97)';
    menu.style.color = '#fff';
    menu.style.padding = '0 0 4px 0';
    menu.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    menu.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    menu.style.fontSize = '12px';
    menu.style.zIndex = '1001';
    menu.style.boxShadow = '0 8px 28px rgba(0, 0, 0, 0.55)';
    menu.style.display = 'none';

    // A single faint hairline disappears on the near-black menu. Pairing a light rule
    // with a dark one below engraves a groove, which reads at a glance without
    // shouting. 0.16 also brings the menu in line with the panels' 0.15 rules.
    function makeDivider() {
        var d = document.createElement('div');
        d.style.cssText = 'height:1px;flex-shrink:0;background:rgba(255,255,255,0.16);' +
            'box-shadow:0 1px 0 rgba(0,0,0,0.4)';
        return d;
    }

    // Shared section header: a small leading icon + an uppercase, muted label.
    // Used by every group so they all read the same way.
    function makeSectionHeader(iconSvg, text) {
        var h = document.createElement('div');
        h.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;' +
            'letter-spacing:0.6px;text-transform:uppercase;color:#8a8a8a;margin-bottom:8px';
        h.innerHTML = sizedIcon(iconSvg, 12) + '<span>' + text + '</span>';
        return h;
    }

    // Host title bar: a connection status dot + the server host.
    var hostContainer = document.createElement('div');
    hostContainer.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:default;' +
        'background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.16);' +
        'border-top-left-radius:8px;border-top-right-radius:8px';

    var hostDot = document.createElement('span');
    hostDot.style.cssText = 'flex-shrink:0;width:7px;height:7px;border-radius:50%;background:#666;' +
        'box-shadow:0 0 0 3px rgba(255,255,255,0.04)';

    var hostValue = document.createElement('div');
    hostValue.id = 'debug-menu-host';
    hostValue.style.cssText = 'flex:1;min-width:0;font-size:11px;color:#eee;font-family:monospace;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500';

    // Function to update host display (text + green/grey status dot)
    function updateHostDisplay() {
        var hostText = 'N/A';
        var connected = roomDebugInfo.size > 0;
        if (connected) {
            // Get host from first room
            var firstRoom = roomDebugInfo.values().next().value;
            if (firstRoom && firstRoom.host) {
                hostText = firstRoom.host;
            }
        }
        hostValue.textContent = hostText;
        hostDot.style.background = connected ? '#22c55e' : '#666';
    }

    // Update host display initially
    updateHostDisplay();

    hostContainer.appendChild(hostDot);
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
    latencyTextSpan.textContent = 'Latency (RTT)';
    latencyTextSpan.style.cssText = 'font-size:11px;color:#ccc';

    latencyLabel.appendChild(latencyTextSpan);
    latencyLabel.appendChild(latencyValueSpan);

    var latencySlider = document.createElement('input');
    latencySlider.type = 'range';
    latencySlider.min = '0';
    latencySlider.max = preferences.maxLatency.toString();
    latencySlider.value = preferences.latencySimulation.delay.toString();
    // No inline `height` — .cds-range owns it so the coarse-pointer rule can grow it.
    latencySlider.className = 'cds-range';
    latencySlider.style.border = 'none';
    latencySlider.style.width = '100%';
    latencySlider.style.padding = '0';
    latencySlider.style.margin = '0';
    latencySlider.style.outline = 'none';
    latencySlider.style.cursor = 'pointer';
    latencySlider.style.webkitAppearance = 'none';
    latencySlider.style.appearance = 'none';
    latencySlider.style.background = 'transparent';
    latencySlider.id = 'latency-slider';

    function getSliderColor(value) {
        var c = latencyRamp(value, preferences.maxLatency);
        return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
    }

    // Build the green→yellow→red fill for a track. Only the `background` is
    // dynamic — track/thumb geometry lives in the base sheet (styles.ts), so the
    // coarse-pointer override isn't clobbered when this sheet is re-appended.
    function trackGradient(value) {
        var color = getSliderColor(value);
        var valuePercent = (value / preferences.maxLatency) * 100;
        var yellowColor = getSliderColor(preferences.maxLatency / 2);
        return (value <= preferences.maxLatency / 2)
            ? `linear-gradient(to right, #00c800 0%, ${yellowColor} ${valuePercent}%, #333 ${valuePercent}%, #333 100%)`
            : `linear-gradient(to right, #00c800 0%, ${yellowColor} 50%, ${color} ${valuePercent}%, #333 ${valuePercent}%, #333 100%)`;
    }

    function paintTrack(sliderId, gradient) {
        var root = getDebugRoot();
        var styleId = sliderId + '-style';
        var existingStyle = root.getElementById(styleId);
        if (existingStyle) { existingStyle.remove(); }
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${sliderId}::-webkit-slider-runnable-track { background: ${gradient}; }
            #${sliderId}::-moz-range-track { background: ${gradient}; }
        `;
        root.appendChild(style);
    }

    function updateSliderColor(value) {
        paintTrack('latency-slider', trackGradient(value));
    }

    // Initialize slider color
    updateSliderColor(parseInt(latencySlider.value));

    // Function to update container border color
    function refreshLogoRing() {
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
        preferences.latencySimulation.enabled = value > 0 || preferences.latencySimulation.jitter > 0;
        updateSliderColor(value);
        refreshLogoRing();
        savePreferences();
        syncPresetButtons(); // a manual drag → "Custom" (no preset highlighted)
    });

    latencyContainer.appendChild(latencyLabel);
    latencyContainer.appendChild(latencySlider);
    menu.appendChild(latencyContainer);

    // Simulate jitter option — mirrors the latency slider; applied as ±jitter around
    // the latency per message (order-preserving). Reuses the in-scope getSliderColor.
    var jitterContainer = document.createElement('div');
    jitterContainer.style.padding = '8px 12px 12px';
    jitterContainer.style.cursor = 'default';
    var jitterLabel = document.createElement('div');
    jitterLabel.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;justify-content:space-between';
    var jitterValueSpan = document.createElement('span');
    jitterValueSpan.id = 'jitter-value';
    jitterValueSpan.style.cssText = 'color:#888;font-size:11px';
    jitterValueSpan.textContent = preferences.latencySimulation.jitter + 'ms';
    var jitterTextSpan = document.createElement('span');
    jitterTextSpan.textContent = 'Jitter';
    jitterTextSpan.style.cssText = 'font-size:11px;color:#ccc';
    jitterLabel.appendChild(jitterTextSpan);
    jitterLabel.appendChild(jitterValueSpan);

    var jitterSlider = document.createElement('input');
    jitterSlider.type = 'range';
    jitterSlider.min = '0';
    jitterSlider.max = preferences.maxLatency.toString();
    jitterSlider.value = preferences.latencySimulation.jitter.toString();
    jitterSlider.id = 'jitter-slider';
    jitterSlider.className = 'cds-range';
    jitterSlider.style.cssText = 'border:none;width:100%;padding:0;margin:0;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent';

    function updateJitterColor(value) {
        paintTrack('jitter-slider', trackGradient(value));
    }
    updateJitterColor(parseInt(jitterSlider.value));

    jitterSlider.addEventListener('input', function() {
        var value = parseInt(jitterSlider.value);
        jitterValueSpan.textContent = value + 'ms';
        preferences.latencySimulation.jitter = value;
        preferences.latencySimulation.enabled = preferences.latencySimulation.delay > 0 || value > 0;
        updateJitterColor(value);
        savePreferences();
        syncPresetButtons(); // a manual drag → "Custom" (no preset highlighted)
    });

    jitterContainer.appendChild(jitterLabel);
    jitterContainer.appendChild(jitterSlider);
    menu.appendChild(jitterContainer);

    // Network presets — one tap sets both sliders. The active preset is derived
    // by matching the saved delay/jitter (no extra persisted state), so it stays
    // in sync with manual drags and the __net() console API.
    var NET_PRESETS = [
        { label: 'Off',   title: 'No simulated latency',                   delay: 0,   jitter: 0  },
        { label: 'Low',   title: 'Low latency · 60ms, no jitter',          delay: 60,  jitter: 0  },
        { label: 'Med',   title: 'Medium latency + jitter · 150ms ± 30ms', delay: 150, jitter: 30 },
        { label: 'Large', title: 'Large latency + jitter · 300ms ± 60ms',  delay: 300, jitter: 60 },
    ];

    // Reflect a chosen (delay, jitter) onto BOTH sliders + their gradients/labels,
    // persist, and re-highlight. Preset-click path only — slider handlers move one.
    function applyLatencySim(delay, jitter) {
        preferences.latencySimulation.delay = delay;
        preferences.latencySimulation.jitter = jitter;
        preferences.latencySimulation.enabled = delay > 0 || jitter > 0;
        latencySlider.value = delay.toString();
        jitterSlider.value = jitter.toString();
        latencyValueSpan.textContent = delay + 'ms';
        jitterValueSpan.textContent = jitter + 'ms';
        updateSliderColor(delay);
        updateJitterColor(jitter);
        refreshLogoRing();
        savePreferences();
        syncPresetButtons();
    }

    function activePresetIndex() {
        var d = preferences.latencySimulation.delay;
        var j = preferences.latencySimulation.jitter;
        for (var i = 0; i < NET_PRESETS.length; i++) {
            if (NET_PRESETS[i].delay === d && NET_PRESETS[i].jitter === j) return i;
        }
        return -1; // custom
    }

    var presetButtons = [];
    function syncPresetButtons() {
        var active = activePresetIndex();
        for (var i = 0; i < presetButtons.length; i++) {
            applySegmentedState(presetButtons[i], i === active);
        }
    }

    var presetContainer = document.createElement('div');
    presetContainer.style.padding = '12px 12px 0';
    presetContainer.style.cursor = 'default';
    var presetLabel = makeSectionHeader(networkIcon, 'Network simulation');
    var presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;gap:4px';
    NET_PRESETS.forEach(function(preset) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cds-hit';
        btn.textContent = preset.label;
        btn.title = preset.title;
        btn.style.cssText = 'flex:1;padding:4px 6px;border:1px solid;border-radius:4px;' +
            'cursor:pointer;font-size:10px;font-family:inherit;transition:background 0.2s,border-color 0.2s';
        applySegmentedState(btn, false);
        bindSegmentedHover(btn);
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            applyLatencySim(preset.delay, preset.jitter);
        });
        presetButtons.push(btn);
        presetRow.appendChild(btn);
    });
    presetContainer.appendChild(presetLabel);
    presetContainer.appendChild(presetRow);
    menu.insertBefore(presetContainer, latencyContainer); // above the latency slider
    syncPresetButtons(); // highlight the saved preset on first open

    menu.appendChild(makeDivider()); // network → auth

    // Auth token section — preview + copy the current token, or clear a stale one
    // that fails onAuth when switching between projects on the same origin.
    var authSection = document.createElement('div');
    authSection.style.padding = '12px';
    authSection.style.cursor = 'default';

    var authLabel = makeSectionHeader(keyIcon, 'Auth token');

    // Empty state (no token present)
    var authEmpty = document.createElement('div');
    authEmpty.textContent = 'None';
    authEmpty.style.cssText = 'color:#666;font-size:11px;font-style:italic';

    // Token preview + copy row
    var tokenRow = document.createElement('div');
    tokenRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:6px';

    var tokenPreview = document.createElement('div');
    tokenPreview.style.cssText = 'flex:1;min-width:0;font-family:monospace;font-size:10px;color:#ddd;' +
        'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;' +
        'padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cds-hit';
    copyBtn.title = 'Copy token';
    copyBtn.style.cssText = 'flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;' +
        'width:26px;height:26px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;' +
        'background:rgba(255,255,255,0.05);color:#fff;cursor:pointer;transition:background 0.2s,border-color 0.2s';
    var copyBtnIcon = sizedIcon(copyIcon, 13);
    copyBtn.innerHTML = copyBtnIcon;

    tokenRow.appendChild(tokenPreview);
    tokenRow.appendChild(copyBtn);

    // Clear button (red)
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cds-hit';
    clearBtn.textContent = 'Clear token';
    clearBtn.style.cssText = 'width:100%;padding:5px 8px;border:1px solid rgba(239,68,68,0.5);border-radius:4px;' +
        'background:rgba(239,68,68,0.2);color:#ef4444;font-size:11px;font-family:inherit;cursor:pointer;' +
        'transition:background 0.2s,border-color 0.2s';

    authSection.appendChild(authLabel);
    authSection.appendChild(authEmpty);
    authSection.appendChild(tokenRow);
    authSection.appendChild(clearBtn);

    // Current token = first live client's in-memory token, else the persisted one
    // (present in storage but not yet loaded into an Auth instance).
    var currentToken: string | null = null;
    function getAuthToken() {
        var t: string | null = null;
        authInstances.forEach(function(a) { if (!t && a.token) { t = a.token; } });
        if (t) { return t; }
        try { return localStorage.getItem('colyseus-auth-token'); } catch (e) { return null; }
    }
    // Middle-truncate so both ends stay legible; full value lives in the title.
    function truncateToken(t) {
        return (t.length > 22) ? (t.slice(0, 12) + '…' + t.slice(-8)) : t;
    }

    // Reflect presence on (re)open: show preview/copy/clear, or the "None" line.
    function syncAuthOption() {
        var token = getAuthToken();
        currentToken = token;
        var present = !!token;
        authEmpty.style.display = present ? 'none' : 'block';
        tokenRow.style.display = present ? 'flex' : 'none';
        clearBtn.style.display = present ? 'block' : 'none';
        if (token) {
            tokenPreview.textContent = truncateToken(token);
            tokenPreview.title = token; // full token on hover
        }
    }
    syncAuthOption();

    // Copy the full token to the clipboard, flashing a green check on the button.
    var copyResetTimer: any = null;
    function flashCopied() {
        copyBtn.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;color:#22c55e;font-size:12px;">✓</span>';
        copyBtn.style.borderColor = 'rgba(34,197,94,0.6)';
        if (copyResetTimer) { clearTimeout(copyResetTimer); }
        copyResetTimer = setTimeout(function() {
            copyBtn.innerHTML = copyBtnIcon;
            copyBtn.style.borderColor = 'rgba(255,255,255,0.2)';
        }, 1000);
    }
    function copyToken() {
        if (!currentToken) { return; }
        try {
            var p = navigator.clipboard && navigator.clipboard.writeText(currentToken);
            if (p && p.then) { p.then(flashCopied, flashCopied); } else { flashCopied(); }
        } catch (e) { flashCopied(); }
    }
    copyBtn.addEventListener('mouseenter', function() { copyBtn.style.background = 'rgba(255,255,255,0.15)'; });
    copyBtn.addEventListener('mouseleave', function() { copyBtn.style.background = 'rgba(255,255,255,0.05)'; });
    copyBtn.addEventListener('click', function(e) { e.stopPropagation(); copyToken(); });
    tokenPreview.addEventListener('click', function(e) { e.stopPropagation(); copyToken(); });

    clearBtn.addEventListener('mouseenter', function() {
        clearBtn.style.background = 'rgba(239,68,68,0.35)';
        clearBtn.style.borderColor = 'rgba(239,68,68,0.7)';
    });
    clearBtn.addEventListener('mouseleave', function() {
        clearBtn.style.background = 'rgba(239,68,68,0.2)';
        clearBtn.style.borderColor = 'rgba(239,68,68,0.5)';
    });
    clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        // Live instances: signOut() nulls the in-memory token + removes storage (real key).
        authInstances.forEach(function(a) { if (a.token) { void a.signOut(); } });
        try { localStorage.removeItem('colyseus-auth-token'); } catch (e) {} // default-key fallback
        syncAuthOption();
    });

    // Auth sits below the network group (after its divider), with its own divider
    // separating it from the position picker.
    menu.appendChild(authSection);
    menu.appendChild(makeDivider()); // auth → position/visibility


    // Panel position and visibility ride side by side: two short controls that would
    // each waste a full-width row of a 226px menu.
    var prefsSection = document.createElement('div');
    prefsSection.style.cssText = 'display:flex;align-items:stretch;gap:8px;padding:12px;cursor:default';

    // Left — a 2×2 grid standing in for the screen, the dot marking the corner.
    // Four corners on four buttons; a dropdown would say less in more space.
    var POSITIONS = [
        { value: 'top-left',     label: 'Top left' },
        { value: 'top-right',    label: 'Top right' },
        { value: 'bottom-left',  label: 'Bottom left' },
        { value: 'bottom-right', label: 'Bottom right' },
    ];

    var positionColumn = document.createElement('div');
    positionColumn.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column';
    positionColumn.appendChild(makeSectionHeader(settingsIcon, 'Position'));

    var positionGrid = document.createElement('div');
    // The 32px floor lives on the row, not on the button: an inline min-height there
    // would outrank .cds-hit and quietly cost the cells their 44px coarse target.
    positionGrid.style.cssText = 'flex:1;display:grid;grid-template-columns:1fr 1fr;' +
        'grid-auto-rows:minmax(32px, 1fr);gap:4px';

    var positionButtons = [];
    function syncPositionButtons() {
        for (var i = 0; i < positionButtons.length; i++) {
            applySegmentedState(positionButtons[i], positionButtons[i].dataset.value === preferences.panelPosition.position);
        }
    }

    POSITIONS.forEach(function(pos) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cds-hit';
        btn.dataset.value = pos.value;
        btn.title = pos.label;
        btn.setAttribute('aria-label', pos.label);
        btn.style.cssText = 'position:relative;padding:0;border:1px solid;border-radius:4px;' +
            'cursor:pointer;transition:background 0.2s,border-color 0.2s';

        // currentColor, so the marker dims and brightens with the button's state.
        var dot = document.createElement('span');
        dot.style.cssText = 'position:absolute;width:10px;height:6px;border-radius:2px;' +
            'background:currentColor;' + verticalEdge(pos.value) + ':6px;' + horizontalEdge(pos.value) + ':6px';
        btn.appendChild(dot);

        applySegmentedState(btn, false);
        bindSegmentedHover(btn);
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            preferences.panelPosition.position = pos.value;
            savePreferences();
            reflow(); // logo, menu, drawer and Predict all anchor off this
            syncPositionButtons();
        });
        positionButtons.push(btn);
        positionGrid.appendChild(btn);
    });
    positionColumn.appendChild(positionGrid);
    syncPositionButtons();

    // Right — get the overlay out of the way for the rest of the page's life.
    var visibilityColumn = document.createElement('div');
    visibilityColumn.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column';
    visibilityColumn.appendChild(makeSectionHeader(eyeSlashIcon, 'Visibility'));

    var hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'cds-hit';
    hideBtn.title = 'Hide the dev tools until you reload the page';
    hideBtn.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:6px;padding:6px 8px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;' +
        'background:rgba(255,255,255,0.05);color:#fff;font-size:10px;line-height:1.3;text-align:center;' +
        'font-family:inherit;cursor:pointer;transition:background 0.2s,border-color 0.2s';
    hideBtn.innerHTML = sizedIcon(eyeSlashIcon, 14) + '<span>Hide for this session</span>';
    hideBtn.addEventListener('mouseenter', function() {
        hideBtn.style.background = 'rgba(255, 255, 255, 0.15)';
        hideBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
    });
    hideBtn.addEventListener('mouseleave', function() {
        hideBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        hideBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    hideBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        setMenuVisible(false); // clears the host-poll interval before everything goes
        hidePanelsForSession();
    });
    visibilityColumn.appendChild(hideBtn);

    prefsSection.appendChild(positionColumn);
    prefsSection.appendChild(visibilityColumn);
    menu.appendChild(prefsSection);

    // Footer — the only place that says how to remove the overlay for good.
    var disableHint = document.createElement('div');
    disableHint.style.cssText = 'padding:0 12px 12px;font-size:10px;line-height:1.4;color:#666';
    disableHint.innerHTML = 'Remove <code style="background:rgba(255,255,255,0.08);padding:1px 4px;' +
        'border-radius:3px;font-family:monospace;">debug.js</code> from your HTML to disable this UI.';
    menu.appendChild(disableHint);

    getDebugRoot().appendChild(menu);

    // Toggle menu on logo click
    var menuVisible = false;
    var hostUpdateInterval = null;

    function setMenuVisible(visible) {
        menuVisible = visible;
        menu.style.display = visible ? 'block' : 'none';
        // Compact: the menu lands in the drawer's box, so the drawer stands down.
        // The reveal state survives, and the drawer comes back when the menu closes.
        setCompactMenuOpen(visible);

        if (visible) {
            updateHostDisplay();
            syncAuthOption(); // refresh enabled/greyed state on each open
            // Update host every second while menu is visible
            hostUpdateInterval = setInterval(updateHostDisplay, 1000);
        } else if (hostUpdateInterval) {
            clearInterval(hostUpdateInterval);
            hostUpdateInterval = null;
        }
    }

    // Two gestures on one target, compact only:
    //   tap        → show/hide the room panels + Predict overlay
    //   long press → open the network-simulation / preferences sheet
    // Desktop keeps the single click-opens-the-menu behaviour.
    var pressTimer: any = null;
    var longPressFired = false;
    var pressOrigin = { x: 0, y: 0 };

    function pressed(down) {
        // A tap should feel like a button, and the cue doubles as long-press feedback.
        logoContainer.style.transform = down ? 'scale(0.92)' : '';
    }

    function cancelPress() {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
        pressed(false);
    }

    logoContainer.addEventListener('pointerdown', function(e: PointerEvent) {
        if (!isCompact() || pressTimer) { return; }
        longPressFired = false;
        pressOrigin = { x: e.clientX, y: e.clientY };
        pressed(true);
        pressTimer = setTimeout(function() {
            pressTimer = null;
            longPressFired = true; // swallows the `click` that follows the release
            pressed(false);
            setMenuVisible(true);
        }, LONG_PRESS_MS);
    });

    // A press that turns into a drag was never a long press.
    logoContainer.addEventListener('pointermove', function(e: PointerEvent) {
        if (!pressTimer) { return; }
        if (Math.abs(e.clientX - pressOrigin.x) > PRESS_SLOP || Math.abs(e.clientY - pressOrigin.y) > PRESS_SLOP) {
            cancelPress();
        }
    });
    logoContainer.addEventListener('pointerup', cancelPress);
    logoContainer.addEventListener('pointerleave', cancelPress);
    logoContainer.addEventListener('pointercancel', function() {
        cancelPress();
        longPressFired = false;
    });

    // Long press on touch otherwise raises the selection callout / context menu.
    logoContainer.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    logoContainer.addEventListener('click', function(e) {
        e.stopPropagation();

        if (!isCompact()) { setMenuVisible(!menuVisible); return; }
        if (longPressFired) { longPressFired = false; return; } // the press already opened the menu
        if (menuVisible) { setMenuVisible(false); return; }     // tap dismisses the sheet first

        setCompactRevealed(!isCompactRevealed());
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
            setMenuVisible(false);
        }
    });
}
