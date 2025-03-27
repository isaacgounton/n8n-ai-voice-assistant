// Webhook configuration
const WEBHOOK_URL = 'https://n8n.etugrand.com/webhook/voice_message';

// DOM elements
const recordButton = document.getElementById('recordButton');
const chatContainer = document.getElementById('chatContainer');
const statusElement = document.getElementById('status');
const circularInterface = document.querySelector('.circular-interface');

// Audio recording variables
let mediaRecorder;
let audioChunks = [];
let recordingTimer;
let recordingStartTime;
let isRecording = false;
let hasPermission = false;
let audioStream = null; // Store the audio stream

// Check for browser support
if (!navigator.mediaDevices || !window.MediaRecorder) {
    statusElement.textContent = 'Audio recording not supported in your browser';
    recordButton.disabled = true;
} else {
    // Request microphone permission once
    requestMicrophonePermission();
}

// Update status display function
function updateStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.classList.add('visible');
        
        // Hide status after 3 seconds if it's not a recording status
        if (!message.includes('Recording')) {
            setTimeout(() => {
                statusElement.classList.remove('visible');
            }, 3000);
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
        recordButton.querySelector('.button-text').textContent = 'Call AI agent';
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
    recordButton.querySelector('.button-text').textContent = 'Call AI agent';
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

// Display user's audio message in chat
function displayUserAudio(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message audio-message';
    
    messageDiv.innerHTML = `
        <div class="message-header">You</div>
        <div class="audio-controls">
            <audio controls src="${audioUrl}"></audio>
            <div class="waveform">🎤</div>
        </div>
    `;
    
    chatContainer.appendChild(messageDiv);
    messageDiv.style.display = 'flex';
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Send audio to webhook
async function sendAudioToWebhook(audioBlob) {
    try {
        // Create FormData to send binary file
        const formData = new FormData();
        formData.append('voice_message', audioBlob, 'audio.wav');
        
        console.log('Sending audio to webhook...');
        updateStatus('Sending message...');
        
        // Send to webhook
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Get the response as blob since it's an audio file
        const responseBlob = await response.blob();
        console.log('Received audio response:', responseBlob);
        
        // Create a URL for the audio blob
        const audioUrl = URL.createObjectURL(responseBlob);
        
        // Display the response
        updateStatus('Playing response...');
        displayAgentResponse({ audioUrl });
        
    } catch (error) {
        console.error('Error sending audio:', error);
        updateStatus('Error sending message');
        
        // Show error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message agent-message';
        errorDiv.textContent = `Error: ${error.message || 'Failed to send message'}`;
        chatContainer.appendChild(errorDiv);
        errorDiv.style.display = 'block';
    }
}

// Display agent's response in chat
function displayAgentResponse(response) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message agent-message audio-message';
    
    // Check if response is audio or text
    if (response.audioUrl) {
        messageDiv.innerHTML = `
            <div class="message-header">Choudou</div>
            <div class="audio-controls">
                <audio autoplay controls src="${response.audioUrl}" 
                       onplay="updateStatus('Playing response...')"
                       onended="updateStatus('Response complete')"
                       onpause="updateStatus('')"></audio>
                <div class="waveform">🔊</div>
            </div>
        `;
    } else if (response.audio) {
        messageDiv.innerHTML = `
            <div class="message-header">Choudou</div>
            <div class="audio-controls">
                <audio autoplay controls src="data:audio/wav;base64,${response.audio}"
                       onplay="updateStatus('Playing response...')"
                       onended="updateStatus('Response complete')"
                       onpause="updateStatus('')"></audio>
                <div class="waveform">🔊</div>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">Choudou</div>
            <div class="message-content">${response.text || response}</div>
        `;
    }
    
    chatContainer.appendChild(messageDiv);
    messageDiv.style.display = 'flex';
    chatContainer.scrollTop = chatContainer.scrollHeight;
} 