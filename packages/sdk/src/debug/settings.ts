import { eyeSlashIcon } from "./icons.ts";
import { applyPanelPosition, getDebugRoot, hidePanelsForSession, preferences, savePreferences } from "./core.ts";
import { createModalOverlay, removeModalFromStack, selectModal } from "./modal.ts";


// Create and open Settings modal
export function openSettingsModal() {
    // Remove existing modal if present
    var existingModal = getDebugRoot().getElementById('debug-settings-modal');
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
    getDebugRoot().appendChild(overlay);

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
