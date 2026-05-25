import { getDebugRoot, preferences, roomDebugInfo } from "./core.ts";
import { createModal, createModalHeader } from "./modal.ts";
import { StateTreeView } from "./state-tree.ts";


// Create and open State Inspector modal
export function openStateInspectorModal(uniquePanelId) {
    var debugInfo = roomDebugInfo.get(uniquePanelId);
    if (!debugInfo || !debugInfo.room) {
        console.warn('Room not found for panel:', uniquePanelId);
        return;
    }

    var room = debugInfo.room;

    // Remove existing modal if present
    var existingModal = getDebugRoot().getElementById('debug-state-inspector-modal');
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

    // Render the state tree and keep it in sync. StateTreeView patches primitive
    // value changes in place (preserving clicks, selection, scroll and focus) and
    // falls back to a throttled full re-render for structural changes.
    var stateView = new StateTreeView(contentContainer, function() { return room.state || {}; });
    stateView.render();

    // Feed decoder changes into the view. Restored on close (see modal.remove below).
    const originalTriggerChanges = room.serializer.decoder.triggerChanges;
    room.serializer.decoder.triggerChanges = function(changes) {
        originalTriggerChanges?.apply(this, arguments);
        stateView.applyChanges(changes);
    };

    modal.appendChild(contentContainer);
    getDebugRoot().appendChild(modal);

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
        // Restore original trigger changes (stops all change processing) and
        // detach the view's document-level listeners.
        room.serializer.decoder.triggerChanges = originalTriggerChanges;
        stateView.dispose();
        originalRemove.call(this);
    };
}
