// Webhook configuration
const WEBHOOK_URL = 'https://n8n.etugrand.com/webhook/voice_message';

// DOM elements
const recordButton = document.getElementById('recordButton');
const chatContainer = document.getElementById('chatContainer');
const statusElement = document.getElementById('status');
const circularInterface = document.querySelector('.circular-interface');
const emptyState = document.getElementById('emptyState');

// Audio recording variables
let mediaRecorder;
let audioChunks = [];
let recordingTimer;
let recordingStartTime;
let isRecording = false;
let hasPermission = false;
let audioStream = null; // Store the audio stream

// Production deployment - remove or simplify tracking mechanism
// We're now handling responses in a simpler way
let messageCounter = 0;

// Check for browser support
if (!navigator.mediaDevices || !window.MediaRecorder) {
    statusElement.textContent = 'Audio recording not supported in your browser';
    recordButton.disabled = true;
    recordButton.classList.add('disabled');
} else {
    // Request microphone permission once
    requestMicrophonePermission();
}

// Update status display function
function updateStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
        
        if (message) {
            statusElement.classList.add('visible');
            
            // Hide status after 3 seconds if it's not a recording status
            if (!message.includes('Recording')) {
                setTimeout(() => {
                    statusElement.classList.remove('visible');
                }, 3000);
            }
        } else {
            statusElement.classList.remove('visible');
        }
    }
}

// Request microphone permission
async function requestMicrophonePermission() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        hasPermission = true;
        updateStatus('Click to start recording');
    } catch (error) {
        console.error('Error getting microphone permission:', error);
        updateStatus('Please allow microphone access');
        showErrorMessage('Microphone access is required. Please enable it in your browser settings.');
    }
}

// Event listeners for recording
recordButton.addEventListener('click', toggleRecording);

// Toggle recording function
async function toggleRecording(e) {
    e.preventDefault();
    
    if (!hasPermission || !audioStream) {
        await requestMicrophonePermission();
        return;
    }
    
    if (!isRecording) {
        await startRecording();
    } else {
        stopRecording();
    }
}

// Start recording function
async function startRecording() {
    try {
        updateStatus('Recording...');
        circularInterface.classList.add('recording');
        recordButton.querySelector('.button-text').textContent = 'Stop Recording';
        recordButton.querySelector('.mic-icon').innerHTML = '<i class="fa-solid fa-stop"></i>';
        
        // Use the existing stream instead of requesting a new one
        mediaRecorder = new MediaRecorder(audioStream);
        
        audioChunks = [];
        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };
        
        recordingStartTime = Date.now();
        updateRecordingTimer();
        recordingTimer = setInterval(updateRecordingTimer, 1000);
        
        mediaRecorder.start();
        isRecording = true;
    } catch (error) {
        console.error('Error starting recording:', error);
        updateStatus('Error accessing microphone');
        circularInterface.classList.remove('recording');
        recordButton.querySelector('.button-text').textContent = 'Call Choudou';
        recordButton.querySelector('.mic-icon').innerHTML = '<i class="fa-solid fa-microphone"></i>';
        isRecording = false;
    }
}

// Update recording timer display
function updateRecordingTimer() {
    const seconds = Math.floor((Date.now() - recordingStartTime) / 1000);
    updateStatus(`Recording... ${seconds}s`);
}

// Stop recording function
function stopRecording(e) {
    if (e) e.preventDefault();
    
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    
    clearInterval(recordingTimer);
    circularInterface.classList.remove('recording');
    recordButton.querySelector('.button-text').textContent = 'Call Choudou';
    recordButton.querySelector('.mic-icon').innerHTML = '<i class="fa-solid fa-microphone"></i>';
    isRecording = false;
    
    mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        displayUserAudio(audioBlob);
        await sendAudioToWebhook(audioBlob);
    };
    
    mediaRecorder.stop();
    updateStatus('Processing...');
}

// Clean up function - call this when the page is unloaded
function cleanup() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
}

// Add cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Check if chat is empty and toggle empty state
function checkChatEmpty() {
    // Get all non-empty-state elements in the chat
    const chatMessages = chatContainer.querySelectorAll('.message');
    
    if (chatMessages.length > 0) {
        if (emptyState) emptyState.style.display = 'none';
    } else {
        if (emptyState) emptyState.style.display = 'flex';
    }
}

// Add a message to the chat container
function addMessageToChat(messageElement) {
    // Add the message to the chat container
    chatContainer.appendChild(messageElement);
    
    // Scroll to the bottom of the chat
    chatContainer.scrollTop = chatContainer.scrollHeight;
    
    // Hide empty state if it's visible
    checkChatEmpty();
}

// Display user's audio message in chat
function displayUserAudio(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message audio-message';
    
    messageDiv.innerHTML = `
        <div class="message-header">You</div>
        <div class="audio-controls">
            <audio controls src="${audioUrl}"></audio>
            <div class="waveform"><i class="fa-solid fa-microphone-lines"></i></div>
        </div>
    `;
    
    addMessageToChat(messageDiv);
}

// Send audio to webhook
async function sendAudioToWebhook(audioBlob) {
    try {
        // Create FormData to send binary file
        const formData = new FormData();
        formData.append('voice_message', audioBlob, 'audio.wav');
        
        updateStatus('Sending message...');
        
        // Show typing indicator while waiting for response
        showTypingIndicator();
        
        // Send to webhook
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            removeTypingIndicator();
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Check content type of response
        const contentType = response.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
            // Handle JSON response
            // First check if response is empty
            const responseText = await response.text();
            if (!responseText || responseText.trim() === '') {
                removeTypingIndicator();
                throw new Error('Empty response from server');
            }
            
            // Now try to parse the JSON
            let rawResponseData;
            try {
                rawResponseData = JSON.parse(responseText);
            } catch (jsonError) {
                removeTypingIndicator();
                throw new Error('Invalid JSON response from server');
            }
            
            // Check if response is an array and extract first item
            const responseData = Array.isArray(rawResponseData) ? rawResponseData[0] : rawResponseData;
            
            if (!responseData) {
                removeTypingIndicator();
                throw new Error('Empty response from server');
            }
            
            if (responseData.error) {
                removeTypingIndicator();
                throw new Error(responseData.error);
            }
            
            // Handle the nested format where audio is an object with base64 and mimeType
            if (responseData.audio && responseData.text) {
                removeTypingIndicator();
                
                // Handle the structured audio object format
                if (typeof responseData.audio === 'object' && responseData.audio.base64) {
                    displayAgentResponse({ 
                        audioBase64: responseData.audio.base64,
                        audioMimeType: responseData.audio.mimeType || 'audio/mpeg',
                        text: responseData.text 
                    });
                } else {
                    // Fall back to the old format
                    displayAgentResponse({ 
                        audio: responseData.audio, 
                        text: responseData.text 
                    });
                }
            } 
            // Only text in this response
            else if (responseData.text) {
                removeTypingIndicator();
                displayAgentResponse({ text: responseData.text });
            } else {
                removeTypingIndicator();
                throw new Error('Invalid response format from server');
            }
        } 
        // Handle audio blob response
        else if (contentType && (contentType.includes('audio/') || contentType.includes('application/octet-stream'))) {
            const audioBlob = await response.blob();
            
            if (audioBlob.size === 0) {
                removeTypingIndicator();
                throw new Error('Received empty audio response');
            }
            
            // Extract text from header if available
            const textHeader = response.headers.get('text');
            
            const audioUrl = URL.createObjectURL(audioBlob);
            updateStatus('Playing response...');
            
            // Display audio with text if available
            removeTypingIndicator();
            displayAgentResponse({ 
                audioUrl: audioUrl,
                text: textHeader || null
            });
        } else {
            removeTypingIndicator();
            throw new Error(`Unexpected content type: ${contentType}`);
        }
        
    } catch (error) {
        console.error('Error in webhook communication:', error);
        updateStatus('Error: ' + error.message);
        
        // Remove typing indicator if still present
        removeTypingIndicator();
        
        // Show error message in chat
        showErrorMessage(error.message || 'Failed to communicate with the server');
    }
}

// Show typing indicator while waiting for response
function showTypingIndicator() {
    // Remove any existing indicator first
    removeTypingIndicator();
    
    const indicatorDiv = document.createElement('div');
    indicatorDiv.className = 'message agent-message';
    indicatorDiv.id = 'typingIndicator';
    
    indicatorDiv.innerHTML = `
        <div class="message-header">Choudou</div>
        <div class="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;
    
    addMessageToChat(indicatorDiv);
}

// Remove typing indicator
function removeTypingIndicator() {
    const existingIndicator = document.getElementById('typingIndicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
}

// Display agent's response in chat
function displayAgentResponse(response) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message agent-message';
    
    let messageContent = '<div class="message-header">Choudou</div>';
    
    // If we have text response, display it
    if (response.text) {
        messageContent += `<div class="text-message">${response.text}</div>`;
    }
    
    // Handle different audio formats
    let audioSrc;
    if (response.audioUrl) {
        // Direct URL to audio blob
        audioSrc = response.audioUrl;
    } else if (response.audioBase64 && response.audioMimeType) {
        // New format with base64 and mimeType
        audioSrc = `data:${response.audioMimeType};base64,${response.audioBase64}`;
    } else if (response.audio) {
        // Legacy format - base64 encoded audio data
        audioSrc = `data:audio/wav;base64,${response.audio}`;
    }
    
    // If we have audio source, add audio player
    if (audioSrc) {
        messageContent += `
            <div class="audio-controls">
                <audio controls src="${audioSrc}"></audio>
                <div class="waveform"><i class="fa-solid fa-volume-high"></i></div>
            </div>
        `;
    }
    
    messageDiv.innerHTML = messageContent;
    addMessageToChat(messageDiv);
    
    // Find the audio element and play it programmatically
    const audioElement = messageDiv.querySelector('audio');
    if (audioElement) {
        // Try to play the audio with a user gesture simulation
        const playPromise = audioElement.play();
        
        // Handle potential autoplay restrictions
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // Silent catch - controls are visible for manual play
            });
        }
    }
}

// Show error message in chat
function showErrorMessage(errorMessage) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message error-message';
    
    messageDiv.innerHTML = `
        <div class="message-header">Error</div>
        <div class="error-content">${errorMessage}</div>
    `;
    
    addMessageToChat(messageDiv);
}