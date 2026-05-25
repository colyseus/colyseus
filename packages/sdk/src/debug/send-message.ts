import { getDebugRoot, roomDebugInfo } from "./core.ts";
import { createModal, createModalHeader, makeDraggable } from "./modal.ts";


// Create and open Send Messages modal
export function openSendMessagesModal(uniquePanelId) {
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
    var existingModal = getDebugRoot().getElementById('debug-send-messages-modal');
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
        option.style.color = '#000';
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

        } catch (e: any) {
            errorContainer.textContent = 'Error: ' + e.message;
            errorContainer.style.display = 'block';
        }
    });

    formContainer.appendChild(sendButton);

    modal.appendChild(formContainer);
    getDebugRoot().appendChild(modal);
}
