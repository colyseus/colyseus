import { closeIcon } from "./icons.ts";
import { getDebugRoot } from "./core.ts";


// Track open modals as an ordered stack (most recent at end)
let modalStack: any[] = [];

const BASE_MODAL_ZINDEX = 10000;


// Function to select a modal (bring to front)
export function selectModal(modal) {
    if (!modal) return;

    // Remove modal from stack if already present
    const index = modalStack.indexOf(modal);
    if (index > -1) {
        modalStack.splice(index, 1);
    }

    // Add to end of stack (most recent)
    modalStack.push(modal);

    // Update z-indexes for all modals based on their position in stack
    var root = getDebugRoot();
    modalStack.forEach((m, i) => {
        if (root.contains(m)) {
            m.style.zIndex = (BASE_MODAL_ZINDEX + i).toString();
        }
    });
}


// Function to remove modal from stack
export function removeModalFromStack(modal) {
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
        if (topModal && getDebugRoot().contains(topModal)) {
            topModal.remove();
        }
    }
});


// Shared modal creation utilities
export function createModalOverlay() {
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


export function createModal(options) {
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


export function createModalHeader(options) {
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


export function makeDraggable(modal, dragHandle) {
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
