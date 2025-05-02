// Popup script for GitHub Repository Downloader

// Function to send a message to the active GitHub tab
function sendMessageToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      // Check if the current tab is GitHub
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url || !activeTab.url.includes('github.com')) {
        reject(new Error('Not on a GitHub page'));
        return;
      }
      
      chrome.tabs.sendMessage(activeTab.id, message, function(response) {
        if (chrome.runtime.lastError) {
          console.error('Error sending message:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  });
}

// Function to show status messages
function showStatus(message, type) {
  const statusDiv = document.createElement('div');
  statusDiv.className = `status ${type || ''}`;
  statusDiv.textContent = message;
  
  // Remove any existing status divs
  const existingStatus = document.querySelector('.status');
  if (existingStatus) {
    existingStatus.remove();
  }
  
  // Find where to insert the status (before the download button)
  const downloadBtn = document.getElementById('download-btn');
  const container = document.querySelector('.container');
  container.insertBefore(statusDiv, downloadBtn);
  
  // Auto-remove success/info messages after 10 seconds, but keep errors
  if (type !== 'error') {
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.remove();
      }
    }, 10000);
  }
  
  return statusDiv;
}

// Show progress bar
function showProgressBar(percent) {
  let progressContainer = document.querySelector('.progress-bar-container');
  let progressBar = document.querySelector('.progress-bar');
  
  if (!progressContainer) {
    progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar-container';
    progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressContainer.appendChild(progressBar);
    
    // Insert before download button
    const downloadBtn = document.getElementById('download-btn');
    const container = document.querySelector('.container');
    container.insertBefore(progressContainer, downloadBtn);
  }
  
  progressContainer.style.display = 'block';
  progressBar.style.width = `${percent}%`;
  
  return { container: progressContainer, bar: progressBar };
}

// Initialize the popup
document.addEventListener('DOMContentLoaded', function() {
  const downloadBtn = document.getElementById('download-btn');
  const settingsBtn = document.getElementById('settings-btn');
  
  // Load user settings
  chrome.storage.sync.get({
    buttonColor: '#2ea44f',
    popupBgColor: '#f6f8fa',
    buttonText: 'Download Repository'
  }, (settings) => {
    // Apply settings
    downloadBtn.style.backgroundColor = settings.buttonColor;
    document.body.style.backgroundColor = settings.popupBgColor;
    
    // Check if text is light or dark and adjust button text color
    const isLight = getColorBrightness(settings.buttonColor) > 170;
    downloadBtn.style.color = isLight ? '#24292e' : '#ffffff';
    
    // Check active tab to see if we're on GitHub
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url || !activeTab.url.includes('github.com')) {
        downloadBtn.disabled = true;
        showStatus('Please navigate to a GitHub repository to use this extension.', 'error');
      } else if (activeTab.url.includes('/tree/')) {
        // Modify button text for directory context
        downloadBtn.textContent = settings.buttonText.replace('Repository', 'Directory');
      } else {
        downloadBtn.textContent = settings.buttonText;
      }
    });
  });
  
  // Settings button click handler
  settingsBtn.addEventListener('click', function() {
    chrome.runtime.openOptionsPage();
  });
  
  // Download button click handler
  downloadBtn.addEventListener('click', function() {
    downloadBtn.disabled = true;
    showStatus('Initiating download process...', 'processing');
    
    sendMessageToActiveTab({ action: 'downloadSubdirectory' })
      .then(response => {
        console.log('Download response:', response);
        if (response && response.success) {
          showStatus('Download started! Check your downloads folder.', 'success');
        } else {
          showStatus(`Error: ${response?.message || 'Failed to start download'}`, 'error');
        }
      })
      .catch(error => {
        console.error('Download error:', error);
        showStatus(`Error: ${error.message || 'Failed to communicate with GitHub page'}`, 'error');
      })
      .finally(() => {
        setTimeout(() => {
          downloadBtn.disabled = false;
        }, 3000);
      });
  });
  
  // Listen for progress updates from the content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateProgress') {
      console.log('Progress update:', message.message);
      
      const progressMatch = message.message.match(/(\d+)%/);
      if (progressMatch && progressMatch[1]) {
        const percent = parseInt(progressMatch[1]);
        showProgressBar(percent);
      }
      
      showStatus(message.message, 'processing');
    } else if (message.action === 'downloadComplete') {
      console.log('Download complete:', message.message);
      showStatus(`Success: ${message.message}`, 'success');
      downloadBtn.disabled = false;
    } else if (message.action === 'downloadError') {
      console.error('Download error:', message.message);
      showStatus(`Error: ${message.message}`, 'error');
      downloadBtn.disabled = false;
    }
  });
});

// Helper function to determine if a color is light or dark
function getColorBrightness(color) {
  // Handle hex colors
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  
  // Handle rgb/rgba colors
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  
  return 255; // Default to light
}
