// Popup script for GitHub Repository Downloader

const defaultSettings = {
  buttonColor: '#2ea44f',
  popupBgColor: '#f6f8fa',
  buttonText: 'Download Repository'
};

// Utility functions
function getColorBrightness(hex) {
  const rgb = parseInt(hex.slice(1), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >>  8) & 0xff;
  const b = (rgb >>  0) & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function sendMessageToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs?.[0]) {
        reject(new Error('No active tab found'));
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  });
}

// Status management
function showStatus(msg, type = '') {
  const existing = document.querySelector('.status');
  existing?.remove();
  
  const statusDiv = document.createElement('div');
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = msg;
  
  const dlBtn = document.getElementById('dlBtn');
  dlBtn.parentNode.insertBefore(statusDiv, dlBtn);
  
  if (type !== 'error') {
    setTimeout(() => statusDiv.remove(), 10000);
  }
  
  return statusDiv;
}

function showProgressBar(percent) {
  let container = document.querySelector('.progress-container');
  let bar = document.querySelector('.progress-bar');
  
  if (!container) {
    container = document.createElement('div');
    container.className = 'progress-container';
    container.innerHTML = '<div class="progress-bar"></div>';
    
    const dlBtn = document.getElementById('dlBtn');
    dlBtn.parentNode.insertBefore(container, dlBtn);
    bar = container.querySelector('.progress-bar');
  }
  
  container.style.display = 'block';
  bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  
  return { container, bar };
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  const dlBtn = document.getElementById('dlBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  
  // Load and apply settings
  chrome.storage.sync.get(defaultSettings, settings => {
    Object.assign(dlBtn.style, {
      backgroundColor: settings.buttonColor,
      color: getColorBrightness(settings.buttonColor) > 170 ? '#24292e' : '#ffffff'
    });
    
    document.body.style.backgroundColor = settings.popupBgColor;
    
    // Check if on GitHub and update button text
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (!tab?.url?.includes('github.com')) {
        dlBtn.disabled = true;
        showStatus('Navigate to a GitHub repository to use this extension.', 'error');
      } else {
        dlBtn.textContent = tab.url.includes('/tree/') 
          ? settings.buttonText.replace('Repository', 'Directory')
          : settings.buttonText;
      }
    });
  });
  
  // Settings button handler
  settingsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // Download button handler
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    showStatus('Initiating download...', 'processing');
    
    try {
      const response = await sendMessageToActiveTab({ action: 'downloadSubdirectory' });
      
      if (response?.success) {
        showStatus('Download started! Check your downloads folder.', 'success');
      } else {
        showStatus(`Error: ${response?.message || 'Failed to start download'}`, 'error');
      }
    } catch (error) {
      console.error('Download error:', error);
      showStatus(`Error: ${error.message || 'Failed to communicate with page'}`, 'error');
    } finally {
      setTimeout(() => { dlBtn.disabled = false; }, 3000);
    }
  });
  
  // Listen for progress updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, message: msg } = message;
    
    switch (action) {
      case 'updateProgress':
        const progressMatch = msg.match(/(\d+)%/);
        if (progressMatch) {
          showProgressBar(parseInt(progressMatch[1]));
        }
        showStatus(msg, 'processing');
        break;
        
      case 'downloadComplete':
        showStatus(`Success: ${msg}`, 'success');
        dlBtn.disabled = false;
        break;
        
      case 'downloadError':
        showStatus(`Error: ${msg}`, 'error');
        dlBtn.disabled = false;
        break;
    }
  });
});
