import { closeIcon } from "./icons.ts";
import { getDebugRoot } from "./core.ts";
import { setInset, setMaxViewportHeight } from "./geometry.ts";
import { isCompact, onReflow } from "./layout.ts";


// Track open modals as an ordered stack (most recent at end)
let modalStack: any[] = [];

const BASE_MODAL_ZINDEX = 10000;


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
    var root = getDebugRoot();
    modalStack.forEach((m, i) => {
        if (root.contains(m)) {
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
        if (topModal && getDebugRoot().contains(topModal)) {
            topModal.remove();
        }
    }
});


/**
 * Size and place a modal for the current breakpoint.
 *
 * Compact turns it into a full-screen sheet: there is no useful "centered 600px
 * window" on a phone, and it sidesteps the `90vh` trap (mobile Safari counts the
 * collapsible URL bar inside `vh`). Drag and resize are meaningless there, so the
 * handles hide and `makeDraggable` no-ops.
 */
export function applyModalLayout(modal, opts) {
    var handles = modal.querySelectorAll('.resize-handle') as NodeListOf<HTMLElement>;

    if (isCompact()) {
        // Flush to the safe area on all four edges — setInset carries the px fallback
        // for engines that can't parse max()/env().
        (['top', 'right', 'bottom', 'left'] as const).forEach(function(side) { setInset(modal, side, 0); });
        modal.style.width = 'auto';
        modal.style.height = 'auto';
        modal.style.minWidth = '0';
        modal.style.minHeight = '0';
        modal.style.maxWidth = 'none';
        modal.style.maxHeight = 'none';
        modal.style.transform = 'none';
        modal.style.borderRadius = '0';
        handles.forEach(function(handle) { handle.style.display = 'none'; });
        return;
    }

    modal.style.right = 'auto';
    modal.style.bottom = 'auto';
    modal.style.borderRadius = '8px';
    modal.style.width = opts.width || '';
    modal.style.height = opts.height || '';
    modal.style.minWidth = opts.minWidth || '';
    modal.style.minHeight = opts.minHeight || '';
    modal.style.maxWidth = opts.maxWidth || '';
    if (opts.maxHeight) { setMaxViewportHeight(modal, opts.maxHeight); }
    else { modal.style.maxHeight = ''; }
    modal.style.top = opts.top || '50%';
    modal.style.left = opts.left || '50%';
    modal.style.transform = opts.transform || 'translate(-50%, -50%)';
    handles.forEach(function(handle) { handle.style.display = ''; });
}


export function createModal(options) {
    var opts = options || {};
    var modal = document.createElement('div');

    // Set ID if provided
    if (opts.id) {
        modal.id = opts.id;
    }

    // Base styles
    modal.className = 'cds-surface';
    modal.style.position = 'fixed';
    modal.style.backgroundColor = opts.backgroundColor || '#1e1e1e';
    modal.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)';
    modal.style.color = '#fff';
    modal.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    modal.style.zIndex = BASE_MODAL_ZINDEX.toString();
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';

    applyModalLayout(modal, opts);

    // Re-shape only when the breakpoint flips — a modal that outlives it would keep a
    // 600px frame on a 390px screen. Reacting to every reflow would instead snap a
    // dragged or resized modal back to its opening geometry on any window resize.
    var wasCompact = isCompact();
    var stopReflow = onReflow(function(state) {
        if (state.compact === wasCompact) { return; }
        wasCompact = state.compact;
        applyModalLayout(modal, opts);
    });

    // Mark modal as selected when clicked
    modal.addEventListener('pointerdown', function(e) {
        selectModal(modal);
    });

    // Mark modal as selected when opened
    selectModal(modal);

    // Override remove to cleanup modal from stack
    var originalRemove = modal.remove.bind(modal);
    modal.remove = function() {
        // Remove from modal stack
        removeModalFromStack(modal);
        stopReflow();

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
    header.style.cursor = (opts.draggable !== false && !isCompact()) ? 'move' : 'default';
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
    closeButton.className = 'cds-hit';
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


// Pointer Events cover mouse, touch and pen in one path, and setPointerCapture
// keeps the stream on the handle once the drag starts — so no document listeners,
// and letting go outside the window can't strand the drag.
export function makeDraggable(modal, dragHandle) {
    var activePointer: number | null = null;
    var dragOffsetX = 0;
    var dragOffsetY = 0;

    dragHandle.setAttribute('data-drag', ''); // touch-action:none — the gesture is ours

    var onPointerDown = function(e: PointerEvent) {
        if (activePointer !== null) { return; }
        if (e.pointerType === 'mouse' && e.button !== 0) { return; }
        if (isCompact()) { return; } // full-screen sheet has nowhere to go

        var rect = modal.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;

        // Set position to current absolute position before removing transform
        modal.style.left = rect.left + 'px';
        modal.style.top = rect.top + 'px';
        modal.style.transform = 'none';

        activePointer = e.pointerId;
        dragHandle.setPointerCapture(e.pointerId);
        e.preventDefault();
    };

    var onPointerMove = function(e: PointerEvent) {
        if (e.pointerId !== activePointer) { return; }
        modal.style.left = (e.clientX - dragOffsetX) + 'px';
        modal.style.top = (e.clientY - dragOffsetY) + 'px';
    };

    var onPointerUp = function(e: PointerEvent) {
        if (e.pointerId !== activePointer) { return; }
        if (dragHandle.hasPointerCapture(e.pointerId)) { dragHandle.releasePointerCapture(e.pointerId); }
        activePointer = null;
    };

    dragHandle.addEventListener('pointerdown', onPointerDown);
    dragHandle.addEventListener('pointermove', onPointerMove);
    dragHandle.addEventListener('pointerup', onPointerUp);
    dragHandle.addEventListener('pointercancel', onPointerUp);

    // Return cleanup function
    return function cleanup() {
        dragHandle.removeEventListener('pointerdown', onPointerDown);
        dragHandle.removeEventListener('pointermove', onPointerMove);
        dragHandle.removeEventListener('pointerup', onPointerUp);
        dragHandle.removeEventListener('pointercancel', onPointerUp);
    };
}
