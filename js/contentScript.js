// This content script runs in the context of GitHub pages
// Configuration options
const CONFIG = {
  useOptimizedDownload: true,  // Set to false to force legacy download method
  debugMode: false,             // Enable detailed logging
  maxRepoSizeMB: 200,    // Max repository size to use optimized method (in MB)
  downloadTimeoutMs: 120000,    // Timeout for repository download (120 seconds)
  showSelectionMode: true,      // Changed from showIconButtons
  maxRetries: 3,
  concurrentDownloads: 10
};

let jsZip = null;
let jsZipLoaded = false;

// Global reference to the status element
let statusElement = null;

// Global selection state
let selectedItems = new Map(); // Map of file/directory paths to item data
// let selectionMode = false; // REMOVED: Checkboxes are always visible, selection state managed by selectedItems.size
let selectAllButton = null;
let mainDownloadButton = null;

// Initialize the status element for progress updates
function initializeStatusElement() {
  // Only create once
  if (statusElement) return;
  
  // Create the status element with styled appearance
  statusElement = document.createElement('div');
  statusElement.className = 'github-repo-downloader-status';
  statusElement.style.position = 'fixed';
  statusElement.style.bottom = '20px';
  statusElement.style.right = '20px';
  statusElement.style.backgroundColor = '#0d1117';
  statusElement.style.color = '#58a6ff';
  statusElement.style.padding = '12px 16px';
  statusElement.style.borderRadius = '6px';
  statusElement.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.24)';
  statusElement.style.zIndex = '9999';
  statusElement.style.fontSize = '14px';
  statusElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  statusElement.style.maxWidth = '400px';
  statusElement.style.transition = 'opacity 0.3s ease-in-out';
  statusElement.style.border = '1px solid #30363d';
  statusElement.style.opacity = '1';
  
  // Add progress bar
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressBar.style.height = '4px';
  progressBar.style.width = '0%';
  progressBar.style.backgroundColor = '#58a6ff';
  progressBar.style.marginTop = '8px';
  progressBar.style.borderRadius = '2px';
  progressBar.style.transition = 'width 0.3s ease-in-out';
  
  // Add close button
  const closeButton = document.createElement('span');
  closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '8px';
  closeButton.style.right = '12px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.fontSize = '18px';
  closeButton.style.color = '#8b949e';
  
  // Add event listener to close button
  closeButton.addEventListener('click', () => {
    document.body.removeChild(statusElement);
    statusElement = null;
  });
  
  // Add elements to the status element
  statusElement.appendChild(closeButton);
  statusElement.appendChild(document.createTextNode('Initializing download...'));
  statusElement.appendChild(progressBar);
  
  // Add status element to the page
  document.body.appendChild(statusElement);
}

// Send progress updates to the status element and background script
function sendProgressUpdate(message, percentage = -1) {
  console.log(`Progress update: ${message}`);
  
  // Update the UI status element
  if (statusElement) {
    // Update text content
    const textNode = statusElement.childNodes[1];
    textNode.textContent = message;
    
    // Update progress bar if percentage is provided
    if (percentage >= 0) {
      const progressBar = statusElement.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = `${Math.min(100, percentage)}%`;
      }
    }
    
    // Auto-dismiss completed downloads after 5 seconds
    if (message.includes("complete") || message.includes("initiated")) {
      setTimeout(() => {
        if (statusElement && statusElement.parentNode) {
          statusElement.style.opacity = '0';
          setTimeout(() => {
            if (statusElement && statusElement.parentNode) {
              statusElement.parentNode.removeChild(statusElement);
              statusElement = null;
            }
          }, 300); // Wait for fade out animation
        }
      }, 5000); // 5 seconds
    }
  }
  
  // Also send message to popup if open
  chrome.runtime.sendMessage({
    action: "updateProgress",
    message: message,
    percentage: percentage
  }).catch(() => {
    // Ignore errors if popup isn't open
  });
}

// Utility functions
const utils = {
  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 255);
  },
  
  formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  },
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  createAbortController(timeoutMs = 20000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timeoutId));
    return controller;
  }
};

// Load JSZip immediately when content script loads
loadJSZip().then(() => {
  jsZipLoaded = true;
  console.log("JSZip successfully pre-loaded");
}).catch(error => {
  console.error("Error pre-loading JSZip:", error);
});

// Function to load JSZip library properly (with CSP compliance)
function loadJSZip() {
  return new Promise((resolve, reject) => {
    console.log("Checking if JSZip is already loaded in content script context");
    
    // First check if JSZip is already available in the global context
    if (typeof JSZip === 'function') {
      console.log("JSZip is already loaded in global context");
      resolve(JSZip);
      return;
    }
    
    console.log("Attempting to load JSZip via chrome.scripting API");
    
    // Request the background script to inject JSZip using the scripting API
        chrome.runtime.sendMessage({
      action: "executeScript",
      scriptUrl: chrome.runtime.getURL('lib/jszip.min.js')
        }, (response) => {
          if (chrome.runtime.lastError) {
        console.error("Error requesting script injection:", chrome.runtime.lastError);
        fallbackLoadJSZip(resolve, reject);
        return;
      }
      
      if (response && response.success) {
        console.log("JSZip injected successfully via chrome.scripting API");
        
        // Check if JSZip is now available in the global context
        if (typeof JSZip === 'function') {
          console.log("JSZip is now available in global context");
          resolve(JSZip);
              } else {
          console.warn("JSZip not found in global context after injection, trying fallback");
          fallbackLoadJSZip(resolve, reject);
            }
          } else {
        console.error("Failed to inject JSZip:", response?.error || "Unknown error");
        fallbackLoadJSZip(resolve, reject);
          }
        });
      });
}

// Fallback method to load JSZip for browsers or contexts where the scripting API fails
function fallbackLoadJSZip(resolve, reject) {
  console.log("Using fallback method to load JSZip");
  
  // Get the URL to the JSZip library
  const jsZipUrl = chrome.runtime.getURL('lib/jszip.min.js');
  console.log("JSZip URL:", jsZipUrl);
  
  // Create a script element to load JSZip
  const scriptElement = document.createElement('script');
  scriptElement.src = jsZipUrl;
  scriptElement.type = 'text/javascript';
  
  // Handle success
  scriptElement.onload = () => {
    console.log("JSZip script loaded successfully via script tag");
    if (typeof JSZip === 'function') {
      console.log("JSZip is now available in global context");
      resolve(JSZip);
    } else {
      console.error("JSZip not found in global context after script load");
      reject(new Error("JSZip not defined after script load"));
    }
  };
  
  // Handle failure
  scriptElement.onerror = (error) => {
    console.error("Error loading JSZip script:", error);
    
    // As a last resort, try loading from a CDN
    console.log("Attempting to load JSZip from CDN");
    const cdnScript = document.createElement('script');
    cdnScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    cdnScript.type = 'text/javascript';
    
    cdnScript.onload = () => {
      console.log("JSZip loaded from CDN");
      if (typeof JSZip === 'function') {
        resolve(JSZip);
      } else {
        reject(new Error("JSZip not defined after loading from CDN"));
      }
    };
    
    cdnScript.onerror = (cdnError) => {
      console.error("Failed to load JSZip from CDN:", cdnError);
      reject(new Error("Failed to load JSZip from all sources"));
    };
    
    document.head.appendChild(cdnScript);
  };
  
  // Add the script to the page
  document.head.appendChild(scriptElement);
}

// Function to add main download button to GitHub UI
function addDownloadButtonToUI() {
  // Check if we're on a GitHub repository page
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length < 3) {
    return; // Not a repository page
  }
  
  const isRepoPage = pathParts.length >= 3 && 
                     !['settings', 'search', 'marketplace', 'explore'].includes(pathParts[1]);
  
  if (!isRepoPage) {
    return;
  }
  
  console.log("Adding download button to GitHub UI");
  
  // Find the repository navigation bar
  const navBar = document.querySelector('nav[aria-label="Repository"], .pagehead-actions, ul.UnderlineNav-body');
  if (!navBar) {
    console.log("Repository navigation bar not found");
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('github-repo-downloader-btn')) {
    return;
  }
  
  // Default settings
  const defaultSettings = {
    buttonColor: '#2ea44f',
    buttonText: 'Download Repository',
    buttonStyle: 'default'
  };
  
  // Create the download button
  const downloadButton = document.createElement('li');
  downloadButton.className = 'UnderlineNav-item d-flex';
  downloadButton.id = 'github-repo-downloader-btn';
  downloadButton.style.marginLeft = '8px';
  
  const isTreeView = window.location.pathname.includes('/tree/');
  
  // Load user settings and then create the button with those settings
  chrome.storage.sync.get(defaultSettings, (settings) => {
    const buttonText = isTreeView ? 
      (settings.buttonText.replace('Repository', 'Directory')) : 
      settings.buttonText;
    
    // Modern GitHub UI (2023+)
    if (navBar.classList.contains('UnderlineNav-body')) {
      downloadButton.innerHTML = `
        <a class="UnderlineNav-item" role="tab" data-view-component="true" aria-current="page">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="margin-right: 4px;">
            <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
          </svg>
          <span data-content="${buttonText}">${buttonText}</span>
        </a>
      `;
      
      // Add styling based on settings
      const navLink = downloadButton.querySelector('a');
      navLink.style.fontWeight = '600';
      
      // Apply styling based on button style setting
      switch(settings.buttonStyle) {
        case 'outline':
          navLink.style.color = settings.buttonColor;
          navLink.style.border = `1px solid ${settings.buttonColor}`;
          navLink.style.borderRadius = '6px';
          navLink.style.padding = '2px 8px';
          // Add hover effect
          navLink.addEventListener('mouseover', () => {
            navLink.style.backgroundColor = `${settings.buttonColor}20`; // 20 = 12% opacity
          });
          navLink.addEventListener('mouseout', () => {
            navLink.style.backgroundColor = '';
          });
          break;
        case 'rounded':
          navLink.style.color = settings.buttonColor;
          navLink.style.borderRadius = '10px';
          // Add hover effect
          navLink.addEventListener('mouseover', () => {
            navLink.style.backgroundColor = `${settings.buttonColor}20`;
          });
          navLink.addEventListener('mouseout', () => {
            navLink.style.backgroundColor = '';
          });
          break;
        case 'pill':
          navLink.style.color = settings.buttonColor;
          navLink.style.borderRadius = '20px';
          navLink.style.padding = '2px 12px';
          // Add hover effect
          navLink.addEventListener('mouseover', () => {
            navLink.style.backgroundColor = `${settings.buttonColor}20`;
          });
          navLink.addEventListener('mouseout', () => {
            navLink.style.backgroundColor = '';
          });
          break;
        default: // default style
          navLink.style.color = settings.buttonColor;
          // Add hover effect
          navLink.addEventListener('mouseover', () => {
            navLink.style.backgroundColor = `${settings.buttonColor}20`;
          });
          navLink.addEventListener('mouseout', () => {
            navLink.style.backgroundColor = '';
          });
      }
      
      navBar.appendChild(downloadButton);
    } 
    // Legacy GitHub UI
    else {
      // Create button for older GitHub UI with custom styling
      downloadButton.innerHTML = `
        <a class="btn btn-sm btn-primary">
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-download mr-1">
            <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
          </svg>
          ${buttonText}
        </a>
      `;
      
      // Apply styling based on settings
      const btnElement = downloadButton.querySelector('a');
      
      // Apply styling based on button style setting
      switch(settings.buttonStyle) {
        case 'outline':
          btnElement.style.backgroundColor = 'transparent';
          btnElement.style.color = settings.buttonColor;
          btnElement.style.border = `1px solid ${settings.buttonColor}`;
          break;
        case 'rounded':
          btnElement.style.backgroundColor = settings.buttonColor;
          btnElement.style.borderColor = settings.buttonColor;
          btnElement.style.color = '#ffffff';
          btnElement.style.borderRadius = '10px';
          break;
        case 'pill':
          btnElement.style.backgroundColor = settings.buttonColor;
          btnElement.style.borderColor = settings.buttonColor;
          btnElement.style.color = '#ffffff';
          btnElement.style.borderRadius = '20px';
          break;
        default: // default style
          btnElement.style.backgroundColor = settings.buttonColor;
          btnElement.style.borderColor = settings.buttonColor;
          btnElement.style.color = '#ffffff';
      }
      
      if (navBar.classList.contains('pagehead-actions')) {
        navBar.insertBefore(downloadButton, navBar.firstChild);
      } else {
        navBar.appendChild(downloadButton);
      }
    }
    
    // Add click event listener to the button
    const buttonElement = downloadButton.querySelector('a');
    buttonElement.addEventListener('click', (event) => {
      event.preventDefault();
      handleMainDownloadClick();
    });
    
    mainDownloadButton = downloadButton;
    
    console.log("Download button added to GitHub UI with custom styling");
  });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadSubdirectory") {
    console.log("Download subdirectory request received");
    
    // Extract repository information from the current URL
    const repoInfo = extractRepositoryInfo(window.location.href);
    if (!repoInfo) {
      console.error("Failed to extract repository information from URL");
      sendResponse({ success: false, message: "Unable to determine repository information" });
      return true;
    }
    
    // Start the download process with the repository info
    downloadSubdirectory(repoInfo);
    sendResponse({ success: true, message: "Download started" });
    return true;
  }
});

// Function to extract repository information from GitHub URL
function extractRepositoryInfo(url) {
  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes('github.com')) {
      return null;
    }

    // Decode the pathname to handle URL-encoded characters
    const decodedPathname = decodeURIComponent(urlObj.pathname);
    const pathParts = decodedPathname.split('/').filter(part => part.length > 0);
    
    if (pathParts.length < 2) {
      return null; // Not enough parts for a valid repo
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    
    let branch = 'main';
    let subdirectory = '';
    
    // Check if URL contains branch and subdirectory info
    if (pathParts.length > 3 && pathParts[2] === 'tree') {
      branch = pathParts[3];
      if (pathParts.length > 4) {
        subdirectory = pathParts.slice(4).join('/');
      }
    } else if (pathParts.length > 3 && pathParts[2] === 'blob') {
      branch = pathParts[3];
      if (pathParts.length > 4) {
        // For file URLs, we want the directory containing the file
        const fileParts = pathParts.slice(4);
        if (fileParts.length > 1) {
          subdirectory = fileParts.slice(0, -1).join('/');
        }
      }
    }
    
    console.log(`Extracted repo info: owner=${owner}, repo=${repo}, branch=${branch}, subdirectory=${subdirectory}`);
    
    return { owner, repo, branch, subdirectory };
  } catch (error) {
    console.error("Error extracting repository info:", error);
    return null;
  }
}

// Function to check if we should use direct download
async function shouldUseDirectDownload(repoInfo, subdirectoryPath) {
  // For repository root, we can always use direct download
  if (!subdirectoryPath || subdirectoryPath === '') {
    return true;
  }
  
  // Check if GitHub provides a download button for this directory
  const downloadBtn = document.querySelector('a[data-testid="download-raw-button"], a[data-turbo-frame="archive-fragment"]');
  return !!downloadBtn;
}

// Generate raw content URL for a GitHub file
function getRawContentUrl(repoInfo, filePath) {
  // Clean up the file path to ensure it doesn't have leading slashes
  const cleanPath = filePath.replace(/^\/+/, '');
  
  // First decode the path in case it already contains URL-encoded characters
  const decodedPath = decodeURIComponent(cleanPath);
  
  // Use the raw.githubusercontent.com domain for direct file access
  // Each path component needs to be properly encoded
  const encodedPath = decodedPath.split('/').map(part => encodeURIComponent(part)).join('/');
  
  return `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/${encodedPath}`;
}

// Generate GitHub API URL for a file
function getApiUrl(repoInfo, filePath) {
  // Clean up the file path to ensure it doesn't have leading slashes
  const cleanPath = filePath.replace(/^\/+/, '');
  
  // First decode the path in case it already contains URL-encoded characters
  const decodedPath = decodeURIComponent(cleanPath);
  
  // Properly encode path components for the API URL
  const encodedPath = decodedPath.split('/').map(part => encodeURIComponent(part)).join('/');
  
  return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${repoInfo.branch}`;
}

// Generate GitHub API URL for a directory
function getDirectoryApiUrl(repoInfo, dirPath) {
  // Clean up the directory path to ensure it doesn't have leading slashes
  const cleanPath = dirPath.replace(/^\/+/, '').replace(/\/+$/, '');
  
  // For root directory, don't include the path parameter
  if (!cleanPath) {
    return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents?ref=${repoInfo.branch}`;
  }
  
  // First decode the path in case it already contains URL-encoded characters
  const decodedPath = decodeURIComponent(cleanPath);
  
  // Now properly encode path components for the API URL
  const encodedPath = decodedPath.split('/').map(part => encodeURIComponent(part)).join('/');
  
  return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${repoInfo.branch}`;
}

// Try to download using GitHub's native download button if available
function tryDirectDownload(repoInfo) {
  console.log("Checking for native GitHub download button...");
  
  // Look for GitHub's download ZIP button
  const downloadZipButton = document.querySelector(
    'a[data-open-app="link"][href$=".zip"], ' + // Modern UI - Archive button
    'a[href$="/archive/refs/heads/' + repoInfo.branch + '.zip"], ' + // Download ZIP for branch
    'a[data-testid="download-raw-button"], ' + // Download raw button
    'a[href*="/archive/refs/heads/"][href$=".zip"]' // Fallback selector
  );
  
  if (downloadZipButton) {
    console.log("Found GitHub native download button:", downloadZipButton);
    
    // Click the button to trigger GitHub's native download
    downloadZipButton.click();
    
    sendProgressUpdate("Using GitHub's native download option.");
    return true;
        } else {
    console.log("No GitHub native download button found. Creating custom one.");
    
    // If we have a subdirectory, we shouldn't use the repository root download
    if (repoInfo.subdirectory && repoInfo.subdirectory.trim() !== '') {
      console.log(`Cannot use direct repository download for subdirectory: ${repoInfo.subdirectory}`);
      return false;
    }
    
    // Try to create our own direct download link for repository root only
    try {
      console.log("Attempting to create direct download link for root repository");
      
      // For root repo downloads, we can use GitHub's archive link
      const archiveUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
      
      console.log("Generated archive URL:", archiveUrl);
      
      // Create a temporary link and click it
      const downloadLink = document.createElement('a');
      downloadLink.href = archiveUrl;
      downloadLink.download = `${repoInfo.repo}.zip`;
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      
      // Log and click
      console.log("Triggering direct download via link:", downloadLink);
      downloadLink.click();
      
      // Clean up
      setTimeout(() => document.body.removeChild(downloadLink), 1000);
      
      sendProgressUpdate("Using direct repository download link.");
      return true;
    } catch (error) {
      console.error("Error creating direct download link:", error);
    }
    
    return false;
  }
}

// Download a file from GitHub with retries
async function downloadFile(repoInfo, filePath, maxRetries = CONFIG.maxRetries) {
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount <= maxRetries) {
    try {
      if (retryCount > 0) {
        console.log(`Retry #${retryCount} for file: ${filePath}`);
      } else {
        console.log(`Downloading file: ${filePath}`);
      }
      
      // First try direct raw content URL
      const directUrl = getRawContentUrl(repoInfo, filePath);
      
      // Use a timeout to prevent hanging requests
      const controller = new AbortController();
      const signal = controller.signal;
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
      
      try {
        const response = await fetch(directUrl, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Accept': '*/*'
          },
          signal: signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          // Get file content as ArrayBuffer for binary support
          const fileData = await response.arrayBuffer();
          console.log(`Downloaded ${filePath.split('/').pop()}, size: ${fileData.byteLength} bytes`);
          return fileData;
        }
        
        // If direct download fails, try the GitHub API
        console.warn(`Direct download failed (${response.status}), trying API...`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.warn(`Fetch error for direct URL: ${fetchError.message}`);
        // Continue to API method
      }
      
      // Try the GitHub API to get file info
      const apiUrl = getApiUrl(repoInfo, filePath);
      
      const apiController = new AbortController();
      const apiSignal = apiController.signal;
      const apiTimeoutId = setTimeout(() => apiController.abort(), 20000); // 20 second timeout
      
      try {
        const apiResponse = await fetch(apiUrl, { signal: apiSignal });
        clearTimeout(apiTimeoutId);
        
        if (!apiResponse.ok) {
          if (apiResponse.status === 404) {
            console.error(`File not found: ${filePath}`);
            throw new Error(`File not found: ${filePath}`);
          } else {
            console.error(`API request failed: ${apiResponse.status}`);
            throw new Error(`GitHub API error (${apiResponse.status})`);
          }
        }
        
        const fileInfo = await apiResponse.json();
        
        // Check if we got a proper file response
        if (!fileInfo || !fileInfo.download_url) {
          console.error("API response missing download_url:", fileInfo);
          throw new Error("File download URL not available");
        }
        
        // Try the download URL from API response
        console.log(`Trying download URL from API: ${fileInfo.download_url}`);
        
        const downloadController = new AbortController();
        const downloadSignal = downloadController.signal;
        const downloadTimeoutId = setTimeout(() => downloadController.abort(), 20000); // 20 second timeout
        
        try {
          const downloadResponse = await fetch(fileInfo.download_url, {
            method: 'GET',
            cache: 'no-store',
            signal: downloadSignal
          });
          
          clearTimeout(downloadTimeoutId);
          
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download file (${downloadResponse.status})`);
          }
          
          // Get file content as ArrayBuffer for binary support
          const fileData = await downloadResponse.arrayBuffer();
          console.log(`Downloaded ${filePath.split('/').pop()}, size: ${fileData.byteLength} bytes`);
          return fileData;
        } catch (downloadError) {
          clearTimeout(downloadTimeoutId);
          throw downloadError; // Re-throw to trigger retry
        }
      } catch (apiError) {
        clearTimeout(apiTimeoutId);
        throw apiError; // Re-throw to trigger retry
              }
            } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount <= maxRetries) {
        // Exponential backoff: wait longer between each retry
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        console.warn(`Download failed for ${filePath}, retrying in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        } else {
        console.error(`Failed to download ${filePath} after ${maxRetries} retries:`, error);
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error(`Failed to download ${filePath} after ${maxRetries} retries`);
}

// Handle subdirectory download with retry logic
async function handleSubdirectoryDownload(repoInfo) {
  console.log(`Downloading subdirectory: ${repoInfo.subdirectory} from ${repoInfo.owner}/${repoInfo.repo}`);
  
  try {
    sendProgressUpdate('Preparing to download subdirectory...');
    
    // Get JSZip instance - try to use existing one or load it
    let zip;
    try {
      if (typeof JSZip === 'function') {
        console.log("Using existing JSZip instance");
        zip = new JSZip();
        } else {
        console.log("Loading JSZip...");
        let JSZipClass = await loadJSZip();
        zip = new JSZipClass();
      }
    } catch (jsZipError) {
      console.error("JSZip loading error:", jsZipError);
      sendProgressUpdate("Error loading ZIP library. Trying fallback...");
      
      // Attempt to use external JSZip library
      try {
        await loadScript(chrome.runtime.getURL("lib/jszip.min.js"));
        console.log("External JSZip library loaded");
        if (typeof JSZip === 'function') {
          zip = new JSZip();
        } else {
          throw new Error("JSZip not available after loading");
        }
      } catch (externalError) {
        console.error("External JSZip loading error:", externalError);
        sendProgressUpdate("Error loading libraries. Trying CDN fallback...");
        
        // Try loading from CDN as last resort
        try {
          await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
          console.log("JSZip loaded from CDN");
          if (typeof JSZip === 'function') {
            zip = new JSZip();
            } else {
            throw new Error("JSZip not available after CDN loading");
          }
        } catch (cdnError) {
          console.error("CDN JSZip loading error:", cdnError);
          throw new Error("Failed to load ZIP library after multiple attempts");
        }
      }
    }
    
    console.log("JSZip ready for use");
    
    // Variables for tracking progress
    let totalFiles = 0;
    let completedFiles = 0;
    let failedFiles = 0;
    let currentOperation = '';
    let retryCount = 0;
    const maxRetries = 2;
    
    // Update progress function
    const updateProgress = (progress) => {
      if (!progress) return;
      
      if (progress.type === 'progress') {
        completedFiles = progress.completed || completedFiles;
        failedFiles = progress.failed || failedFiles;
        totalFiles = progress.total || totalFiles;
        currentOperation = progress.currentOperation || currentOperation;
        
        // Calculate percentage if we have total files
        let percentage = 0;
        if (totalFiles > 0) {
          percentage = Math.round((completedFiles / totalFiles) * 100);
        }
        
        let statusText = `Downloaded ${completedFiles}/${totalFiles} files`;
        if (failedFiles > 0) {
          statusText += ` (${failedFiles} failed)`;
        }
        
        if (retryCount > 0) {
          statusText += ` - Retry #${retryCount}`;
        }
        
        if (percentage > 0) {
          statusText += ` - ${percentage}% complete`;
        }
        
        sendProgressUpdate(statusText, percentage);
        
        if (currentOperation) {
          console.log(currentOperation);
        }
      }
    };
    
    // Try to download the subdirectory with retries if needed
    let downloadResult = null;
    let retry = true;
    
    while (retry && retryCount <= maxRetries) {
      try {
        // If this is a retry, adjust concurrency to avoid rate limiting
        const concurrency = retryCount === 0 ? 10 : Math.max(3, 10 - (retryCount * 3));
        
        if (retryCount > 0) {
          sendProgressUpdate(`Retry #${retryCount}: Downloading remaining files with reduced concurrency...`);
          console.log(`Retry #${retryCount}: Using concurrency of ${concurrency}`);
        }
        
        // Process the directory with our improved function
        downloadResult = await processDirectoryConcurrent(
          repoInfo,
          repoInfo.subdirectory,
          zip,
          repoInfo.subdirectory,
          updateProgress,
          concurrency
        );
        
        // Update our progress tracking
        completedFiles = downloadResult.completedFiles;
        failedFiles = downloadResult.failedFiles;
        totalFiles = downloadResult.totalFiles;
        
        // If we have no failed files or we've hit max retries, don't retry again
        retry = failedFiles > 0 && retryCount < maxRetries;
        
        if (retry) {
          retryCount++;
          } else {
          // Break the loop if we're done
          break;
          }
        } catch (error) {
        console.error("Error during directory processing:", error);
        sendProgressUpdate(`Error: ${error.message}`);
        
        // Increment retry counter and try again if we haven't hit max retries
        if (retryCount < maxRetries) {
          retryCount++;
          sendProgressUpdate(`Retrying download (${retryCount}/${maxRetries})...`);
        } else {
          // Give up after max retries
          retry = false;
          throw error;
        }
      }
    }
    
    // Generate the ZIP file
    sendProgressUpdate(`Creating ZIP file...`);
    console.log(`Creating ZIP file with ${completedFiles} files`);
    
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (metadata) => {
      sendProgressUpdate(`Creating ZIP: ${Math.round(metadata.percent)}%`);
    });
    
    // Get naming policy setting
    const defaultSettings = {
      namingPolicy: 'fullPath' // Default to full path naming
    };
    
    // Determine the file name based on the naming policy
    let fileName;
    try {
      const settings = await new Promise(resolve => {
        chrome.storage.sync.get(defaultSettings, resolve);
      });
      
      if (settings.namingPolicy === 'simpleName') {
        // Simple name: just use the last part of the subdirectory path
        const subdirName = repoInfo.subdirectory.split('/').pop();
        fileName = `${subdirName}.zip`;
      } else {
        // Full path: use the complete path with owner, repo, and subdirectory
        fileName = `${repoInfo.owner}_${repoInfo.repo}_${repoInfo.subdirectory.replace(/\//g, '_')}.zip`;
      }
      console.log(`Using naming policy '${settings.namingPolicy}' for ZIP file: ${fileName}`);
    } catch (error) {
      console.error("Error getting naming policy setting:", error);
      // Fallback to full path naming on error
      fileName = `${repoInfo.owner}_${repoInfo.repo}_${repoInfo.subdirectory.replace(/\//g, '_')}.zip`;
    }
    
    // Create download link
    try {
      console.log(`Creating download for ZIP file (${zipBlob.size} bytes)`);
      
      // Directly trigger the download instead of opening a new page
      await triggerDownload(zipBlob, fileName); // MODIFIED: Use direct download
      
      // No longer storing blob in background for this flow, as triggerDownload handles the blob directly.
      // const blobId = await new Promise((resolve, reject) => { ... });
      // await openDownloadPage(blobId, fileName, zipBlob.size);
      
      if (failedFiles > 0) {
        sendProgressUpdate(`Download initiated with ${failedFiles} missing files. Archive size: ${utils.formatBytes(zipBlob.size)}`);
      } else {
        sendProgressUpdate(`Download initiated! Archive size: ${utils.formatBytes(zipBlob.size)}`);
      }
    } catch (downloadError) {
      console.error("Error creating download link:", downloadError);
      
      // Fall back to direct download (this is now redundant as triggerDownload is the direct method)
      // sendProgressUpdate("Using direct download as fallback...");
      // try { ... old fallback ... } catch (fallbackError) { ... }
      // The main triggerDownload already IS the direct download. If it fails, its catch block handles it.
      sendProgressUpdate(`Failed to download: ${downloadError.message}`);
    }
  } catch (error) {
    console.error("Subdirectory download failed:", error);
    sendProgressUpdate(`Download failed: ${error.message}`);
  }
}

// Main function to handle repository downloads
function downloadSubdirectory(repoInfo) {
  console.log("Download initiated with repo info:", repoInfo);
  
  // If not provided, try to extract repository information from the current URL
  if (!repoInfo) {
    repoInfo = extractRepositoryInfo(window.location.href);
    console.log("Extracted repository info from URL:", repoInfo);
  }
  
  // Validate repository information
  if (!repoInfo || !repoInfo.owner || !repoInfo.repo) {
    const errorMsg = "Error: Repository information is incomplete or not available.";
    console.error(errorMsg, repoInfo);
    sendProgressUpdate(errorMsg);
    return;
  }
  
  // Ensure branch name is set correctly
  if (!repoInfo.branch) {
    // Default to main but try to detect if repository uses master instead
    repoInfo.branch = window.location.href.includes('/tree/master/') ? 'master' : 'main';
    console.log(`Using detected branch: ${repoInfo.branch}`);
  }
  
  // Set a global status element for progress updates
  initializeStatusElement();
  
  // Check if we're downloading a subdirectory or the whole repository
  if (repoInfo.subdirectory && repoInfo.subdirectory.trim() !== '') {
    // We're downloading a specific subdirectory
    console.log(`Detected subdirectory download: ${repoInfo.subdirectory}`);
    sendProgressUpdate(`Preparing to download subdirectory: ${repoInfo.subdirectory}`);
    
    // Use our fast concurrent download method
    handleSubdirectoryDownload(repoInfo);
  } else {
    // We're downloading the entire repository - use GitHub's native download
    console.log("Detected full repository download");
    sendProgressUpdate("Downloading full repository using GitHub's native download");
    
    // Try to find and click GitHub's download button first
    const downloadButton = document.querySelector('a[data-turbo-frame="repo-content-turbo-frame"][href$=".zip"]');
    
    if (downloadButton) {
      console.log("Found GitHub download button, clicking it");
      downloadButton.click();
      sendProgressUpdate("Download initiated through GitHub's native download");
      return;
    }
    
    // If no button found, construct a direct download link
    const archiveUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
    console.log(`Using direct download URL: ${archiveUrl}`);
    
    // Use our background script to download the file
      chrome.runtime.sendMessage({
      action: "downloadRepositoryZip",
      url: archiveUrl,
      fileName: `${repoInfo.owner}_${repoInfo.repo}.zip`
    }, response => {
        if (response && response.success) {
        sendProgressUpdate("Download initiated");
        } else {
        const errorMessage = response?.error || "Download failed";
        console.error("Download error:", errorMessage);
        sendProgressUpdate(`Error: ${errorMessage}`);
      }
    });
  }
}

// Function to open the download page with specified parameters
function openDownloadPage(blobId, filename, fileSize) {
  return new Promise((resolve, reject) => {
    try {
      // Construct the download page URL with parameters
      const downloadUrl = chrome.runtime.getURL("html/download.html") + 
        `?blobId=${encodeURIComponent(blobId)}` +
        `&fileName=${encodeURIComponent(filename)}` +
        `&fileSize=${encodeURIComponent(fileSize)}` +
        `&autoStart=true`;
      
      console.log("Opening download page:", downloadUrl);
      
      // Open the download page in a new tab
      chrome.runtime.sendMessage({
        action: "openTab",
        url: downloadUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error opening download page:", chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else if (response && response.success) {
          resolve(response);
              } else {
          reject(new Error("Failed to open download page"));
        }
      });
    } catch (error) {
      console.error("Error constructing download page URL:", error);
      reject(error);
    }
  });
}

// Download the full repository ZIP using GitHub's native download URL via background script
async function downloadRepositoryZip(repoInfo) {
  try {
    console.log(`Downloading full repository ZIP for ${repoInfo.owner}/${repoInfo.repo}:${repoInfo.branch}`);
    
    // Construct GitHub's native download URL for the repository
    const repoZipUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
    console.log("Repository ZIP URL:", repoZipUrl);
    
    // Use the background script to download the ZIP (bypasses CORS)
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: "downloadRepositoryZip",
        url: repoZipUrl,
        filename: utils.sanitizeFilename(`${repoInfo.repo}-${repoInfo.branch}.zip`),
        timeoutMs: CONFIG.downloadTimeoutMs
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error in background download:", chrome.runtime.lastError);
          resolve({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          resolve(response);
        }
      });
    });
    
    if (!result || !result.success) {
      throw new Error(result?.error || "Failed to download repository ZIP");
    }
    
    console.log(`Repository ZIP downloaded via background script, size: ${utils.formatBytes(result.size)}`);
    
    // Get the blob from storage
    const blobData = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
        action: "requestDownloadBlob",
        blobId: result.blobId
      }, (response) => {
          if (chrome.runtime.lastError) {
          console.error("Error retrieving blob:", chrome.runtime.lastError);
          resolve(null);
        } else if (!response || !response.success) {
          console.error("Failed to retrieve blob:", response?.error);
          resolve(null);
          } else {
          resolve(response);
          }
        });
      });
      
    if (!blobData || !blobData.blob) {
      throw new Error("Failed to retrieve repository ZIP data");
    }
    
    // Check if the repository is too large
    const repositorySizeMB = blobData.blob.size / (1024 * 1024);
    if (repositorySizeMB > CONFIG.maxRepoSizeMB) {
      console.warn(`Repository size (${repositorySizeMB.toFixed(2)} MB) exceeds max size (${CONFIG.maxRepoSizeMB} MB)`);
        return {
        success: false,
        error: `Repository is too large (${repositorySizeMB.toFixed(2)} MB) for optimized download. Try the legacy method.`
      };
    }
        
        return {
          success: true,
      blob: blobData.blob,
      filename: blobData.filename || `${repoInfo.repo}-${repoInfo.branch}.zip`,
      size: blobData.blob.size
    };
  } catch (error) {
    console.error("Error downloading repository ZIP:", error);
          return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Extract a specific subdirectory from the repository ZIP
async function extractSubdirectoryFromZip(zipBlob, repoInfo, subdirectoryPath, progressCallback) {
  try {
    console.log(`Extracting subdirectory '${subdirectoryPath}' from repository ZIP`);
    
    // Default progress callback if not provided
    const updateProgress = progressCallback || ((message) => console.log(message));
    
    // Load the original ZIP in memory
    let JSZipClass;
    try {
      JSZipClass = await loadJSZip();
    } catch (jsZipError) {
      console.error("Failed to load JSZip for extraction:", jsZipError);
      throw new Error("Could not load ZIP processing library: " + jsZipError.message);
    }
    
    // Open the repository ZIP
    console.log("Opening repository ZIP file");
    updateProgress("Opening repository ZIP file...");
    const originalZip = await JSZipClass.loadAsync(zipBlob);
    
    // Create a new ZIP for the subdirectory
    const subdirectoryZip = new JSZipClass();
    
    // Find the repository folder name prefix in the ZIP
    // GitHub ZIPs typically have a root folder named "repo-branch"
    const zipFiles = Object.keys(originalZip.files);
    if (zipFiles.length === 0) {
      throw new Error("Repository ZIP is empty");
    }
    
    // Get the repo-branch folder name from the first entry
    const rootFolder = zipFiles[0].split('/')[0];
    console.log("ZIP root folder:", rootFolder);
    
    // The full path to the subdirectory in the ZIP
    const fullSubdirPath = subdirectoryPath ? `${rootFolder}/${subdirectoryPath}/` : rootFolder + '/';
    console.log("Looking for subdirectory path in ZIP:", fullSubdirPath);
    
    // Count files in subdirectory to track progress
    const filesToProcess = zipFiles.filter(path => 
      path.startsWith(fullSubdirPath) && 
      path !== fullSubdirPath &&
      !originalZip.files[path].dir
    );
    
    console.log(`Found ${filesToProcess.length} files in subdirectory to extract`);
    updateProgress(`Found ${filesToProcess.length} files to extract`);
    
    // If no files found, the subdirectory might not exist or might be empty
    if (filesToProcess.length === 0) {
      // Check if the directory itself exists, even if it's empty
      const dirExists = zipFiles.some(path => path === fullSubdirPath);
      if (dirExists) {
        console.log("Directory exists but is empty");
        updateProgress("Directory is empty, creating empty ZIP file");
        // Create an empty file to indicate it's not a mistake
        subdirectoryZip.file("README.txt", "This directory was empty in the repository.");
      } else {
        throw new Error(`Subdirectory '${subdirectoryPath}' not found in repository ZIP`);
      }
    }
    
    // Get subdirectory name for the new ZIP root
    const subdirName = subdirectoryPath ? subdirectoryPath.split('/').pop() : repoInfo.repo;
    let filesProcessed = 0;
    
    // Process each file in the subdirectory
    for (const filePath of filesToProcess) {
      try {
        // Skip directories
        if (originalZip.files[filePath].dir) continue;
        
        // Calculate the relative path from the subdirectory
        // We want to maintain the proper folder structure but remove the repository root prefix
        let relativePath;
        
        if (subdirectoryPath) {
          // For specific subdirectory extraction, make that subdirectory the root
          // Remove everything up to and including the subdirectory path
          relativePath = filePath.substring(fullSubdirPath.length);
        } else {
          // For repository root, keep the relative structure but remove root folder prefix
          relativePath = filePath.substring(rootFolder.length + 1);
        }
        
        // Get the file content
        const fileData = await originalZip.files[filePath].async('arraybuffer');
        
        // Add to the new ZIP
        subdirectoryZip.file(relativePath, fileData);
        
        // Update progress
        filesProcessed++;
        if (filesProcessed % 10 === 0 || filesProcessed === filesToProcess.length) {
          const progressMessage = `Extracted ${filesProcessed}/${filesToProcess.length} files`;
          console.log(progressMessage);
          updateProgress(progressMessage);
        }
      } catch (fileError) {
        console.error(`Error extracting file ${filePath}:`, fileError);
        // Continue with next file
      }
    }
    
    console.log(`Successfully extracted ${filesProcessed} files to new ZIP`);
    updateProgress(`Creating ZIP file for ${subdirName}...`);
    
    // Generate the ZIP blob with compression
    const zipBlob = await subdirectoryZip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 5 // Medium compression level for balance of speed vs size
      }
    }, (metadata) => {
      // Update progress during ZIP generation
      if (metadata.percent % 10 === 0) {
        const progressMessage = `Creating ZIP file: ${Math.round(metadata.percent)}% complete`;
        updateProgress(progressMessage);
      }
    });
    
    console.log(`ZIP file generated successfully: ${utils.formatBytes(zipBlob.size)}`);
    
    return {
      success: true,
      zipBlob: zipBlob,
      filename: `${subdirName}.zip`,
      filesCount: filesProcessed,
      size: zipBlob.size
    };
      } catch (error) {
    console.error("Error extracting subdirectory from ZIP:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Generate the final ZIP file from the extracted subdirectory
async function generateSubdirectoryZip(subdirZip, filename, updateStatus) {
  try {
    console.log(`Generating ZIP file: ${filename}`);
    
    // Generate the ZIP blob with options for good compression and browser compatibility
    const zipBlob = await subdirZip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 5 // Medium compression level for balance of speed vs size
      }
    }, (metadata) => {
      // Update progress during ZIP generation
      const percent = Math.round(metadata.percent);
      updateStatus(`Creating ZIP file: ${percent}% complete...`);
      console.log(`ZIP generation progress: ${percent}%`);
    });
    
    console.log(`ZIP file generated successfully: ${utils.formatBytes(zipBlob.size)}`);
    
    return {
      success: true,
      blob: zipBlob,
      filename: filename,
      size: zipBlob.size
    };
  } catch (error) {
    console.error("Error generating ZIP file:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to observe DOM changes and manage the interface
function setupMutationObserver() {
  console.log("[GRD] Setting up MutationObserver.");
  // Initial attempt to add UI elements
  setTimeout(() => {
    console.log("[GRD] Initial UI setup timeout.");
    addDownloadButtonToUI();
    // REMOVED: addCheckboxesToFileRows(); - conflicts with overlay system
  }, 750);

  const observer = new MutationObserver((mutationsList, observerInstance) => {
    let relevantChange = false;
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' || mutation.type === 'subtree') {
        const targets = [
          '.js-details-container', '.js-navigation-container', 
          'div[role="grid"]', '.react-directory-filename-column',
          '.Box-row', 'table tbody'
        ];
        if (mutation.target && typeof mutation.target.matches === 'function' && targets.some(s => mutation.target.matches(s))) {
          relevantChange = true;
          break;
        }
        if (mutation.addedNodes.length > 0) {
           for (const node of mutation.addedNodes) {
               if (node.nodeType === Node.ELEMENT_NODE && targets.some(s => node.matches && node.matches(s) || node.querySelector && node.querySelector(s))) {
                   relevantChange = true;
                   break;
               }
           }
        }
      }
      if (relevantChange) break;
    }

    if (relevantChange) {
      console.log("[GRD] MutationObserver detected relevant DOM change. Re-applying UI elements.");
      clearTimeout(observerInstance.timeoutId);
      observerInstance.timeoutId = setTimeout(() => {
        addDownloadButtonToUI();
        // REMOVED: addCheckboxesToFileRows(); - conflicts with overlay system
      }, 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  
  // Periodic check as a fallback
  setInterval(() => {
    if (!document.getElementById('github-repo-downloader-btn')) {
        const pathParts = window.location.pathname.split('/');
        const isRepoPage = pathParts.length >= 3 && !['settings', 'search', 'marketplace', 'explore'].includes(pathParts[1]);
        if (isRepoPage) {
            console.log("[GRD] Periodic check: Adding missing main download button.");
            addDownloadButtonToUI();
        }
    }
  }, 7000);
}

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMutationObserver);
} else {
  setupMutationObserver();
}

console.log("GitHub Repository Downloader with checkbox selection system loaded");

// Process a directory concurrently, downloading all files with limited concurrency
async function processDirectoryConcurrent(repoInfo, dirPath, zip, basePath, progressCallback, maxConcurrent = CONFIG.concurrentDownloads) {
  console.log(`Processing directory: ${dirPath}`);
  
  const contents = await fetchDirectoryContents(repoInfo, dirPath);
  if (!Array.isArray(contents)) {
    throw new Error(`Invalid directory contents for ${dirPath}`);
  }
  
  const files = contents.filter(item => item.type === 'file');
  const dirs = contents.filter(item => item.type === 'dir');
  
  let completedFiles = 0;
  let failedFiles = 0;
  const totalFiles = files.length;
  
  // Process files in chunks
  const fileChunks = [];
  for (let i = 0; i < files.length; i += maxConcurrent) {
    fileChunks.push(files.slice(i, i + maxConcurrent));
  }
  
  for (let i = 0; i < fileChunks.length; i++) {
    const chunk = fileChunks[i];
    console.log(`Processing chunk ${i + 1}/${fileChunks.length} (${chunk.length} files)`);
    
    const results = await Promise.allSettled(chunk.map(async file => {
      try {
        let relativePath = file.path;
        if (basePath && relativePath.startsWith(basePath)) {
          relativePath = relativePath.substring(basePath.length).replace(/^\/+/, '');
        }
        
        const content = await downloadFile(repoInfo, file.path);
        zip.file(relativePath, content);
        
        completedFiles++;
        progressCallback?.({
          type: 'progress',
          completed: completedFiles,
          failed: failedFiles,
          total: totalFiles,
          currentOperation: `Downloaded ${file.name}`
        });
        
        return { success: true, path: file.path };
      } catch (error) {
        console.error(`Failed to process file ${file.path}:`, error);
        failedFiles++;
        
        progressCallback?.({
          type: 'progress',
          completed: completedFiles,
          failed: failedFiles,
          total: totalFiles,
          currentOperation: `Failed: ${file.name} - ${error.message}`
        });
        
        return { success: false, path: file.path, error: error.message };
      }
    }));
    
    // Log results
    const successful = results.filter(r => r.value?.success).length;
    const failed = results.length - successful;
    console.log(`Chunk ${i + 1} complete: ${successful} successful, ${failed} failed`);
  }
  
  // Process subdirectories recursively
  for (const dir of dirs) {
    await processDirectoryConcurrent(repoInfo, dir.path, zip, basePath, progressCallback, maxConcurrent);
  }
  
  return { completedFiles, failedFiles, totalFiles };
}

async function fetchDirectoryContents(repoInfo, path = '') {
  const apiUrl = getApiUrl(repoInfo, path);
  const controller = utils.createAbortController();
  
  try {
    const response = await fetch(apiUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch directory contents for ${path}:`, error);
    throw error;
  }
}

function getApiUrl(repoInfo, path = '') {
  return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${path}?ref=${repoInfo.branch}`;
}

// Load JSZip library
async function loadJSZip() {
  if (jsZipLoaded && jsZip) return jsZip;
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "executeScript",
      scriptUrl: chrome.runtime.getURL('lib/jszip.min.js')
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      if (!response?.success) {
        reject(new Error(response?.error || 'Failed to load JSZip'));
        return;
      }
      
      // Check if JSZip is available
      if (typeof JSZip !== 'undefined') {
        jsZip = JSZip;
        jsZipLoaded = true;
        resolve(jsZip);
      } else {
        reject(new Error('JSZip not available after loading'));
      }
    });
  });
}

// Function to add main download button to GitHub UI
function addDownloadButtonToUI() {
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length < 3) return;
  
  const isRepoPage = pathParts.length >= 3 && 
                     !['settings', 'search', 'marketplace', 'explore'].includes(pathParts[1]);
  
  if (!isRepoPage) return;
  
  const navBar = document.querySelector('nav[aria-label="Repository"], .pagehead-actions, ul.UnderlineNav-body');
  if (!navBar || document.getElementById('github-repo-downloader-btn')) return;
  
  const defaultSettings = {
    buttonColor: '#2ea44f',
    buttonText: 'Download Repository',
    buttonStyle: 'default'
  };
  
  const downloadButton = document.createElement('li');
  downloadButton.className = 'UnderlineNav-item d-flex';
  downloadButton.id = 'github-repo-downloader-btn';
  downloadButton.style.marginLeft = '8px';
  
  chrome.storage.sync.get(defaultSettings, (settings) => {
    const isTreeView = window.location.pathname.includes('/tree/');
    const buttonText = isTreeView ? 
      settings.buttonText.replace('Repository', 'Directory') : 
      settings.buttonText;
    
    if (navBar.classList.contains('UnderlineNav-body')) {
      downloadButton.innerHTML = `
        <a class="UnderlineNav-item" role="tab" data-view-component="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="margin-right: 4px;">
            <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
          </svg>
          <span data-content="${buttonText}">${buttonText}</span>
        </a>
      `;
      
      const navLink = downloadButton.querySelector('a');
      navLink.style.fontWeight = '600';
      navLink.style.color = settings.buttonColor;
      
      navBar.appendChild(downloadButton);
    } else {
      downloadButton.innerHTML = `
        <a class="btn btn-sm btn-primary">
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16">
            <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
          </svg>
          ${buttonText}
        </a>
      `;
      
      const btnElement = downloadButton.querySelector('a');
      btnElement.style.backgroundColor = settings.buttonColor;
      btnElement.style.borderColor = settings.buttonColor;
      btnElement.style.color = '#ffffff';
      
      if (navBar.classList.contains('pagehead-actions')) {
        navBar.insertBefore(downloadButton, navBar.firstChild);
      } else {
        navBar.appendChild(downloadButton);
      }
    }
    
    mainDownloadButton = downloadButton;
    
    const buttonElement = downloadButton.querySelector('a');
    buttonElement.addEventListener('click', (event) => {
      event.preventDefault();
      handleMainDownloadClick();
    });
    
    console.log("Download button added to GitHub UI");
  });
}

function handleMainDownloadClick() {
  // Check if we have selected items in the new checkbox system
  loadState().then(state => {
    const selectedIds = Object.keys(state).filter(k => state[k]);
    const selectedCount = selectedIds.length;
    
    console.log(`Main download clicked: ${selectedCount} items selected`);
    
    if (selectedCount === 0) {
      // Download entire repository
      const repoInfo = extractRepositoryInfo(window.location.href);
      if (repoInfo) {
        console.log("Downloading entire repository");
        downloadRepository(repoInfo);
      }
    } else {
      // Download selected items
      console.log("Downloading selected items:", selectedIds);
      downloadSelectedItemsFromCheckboxes();
    }
  });
}

async function downloadSelectedItemsFromCheckboxes() {
  const state = await loadState();
  const selectedIds = Object.keys(state).filter(k => state[k]);
  
  if (selectedIds.length === 0) return;
  
  console.log(`Downloading ${selectedIds.length} selected items`);
  initializeStatusElement();
  sendProgressUpdate(`Preparing to download ${selectedIds.length} selected items...`);
  
  try {
    let JSZipClass;
    try {
      JSZipClass = await loadJSZip();
    } catch (error) {
      throw new Error("Failed to load ZIP library: " + error.message);
    }
    
    const zip = new JSZipClass();
    const repoInfo = extractRepositoryInfo(window.location.href);
    
    let completedItems = 0;
    let failedItems = 0;
    const totalItems = selectedIds.length;
    
    // Get all rows to find the corresponding file info for each selected ID
    const rows = getRows();
    
    for (const selectedId of selectedIds) {
      try {
        // Find the row with this ID
        const row = rows.find(r => getId(r) === selectedId);
        if (!row) {
          console.warn(`Could not find row for selected ID: ${selectedId}`);
          failedItems++;
          continue;
        }
        
        const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
        if (!link) {
          console.warn(`Could not find link for selected ID: ${selectedId}`);
          failedItems++;
          continue;
        }
        
        const href = link.getAttribute('href') || link.href;
        const isDirectory = href.includes('/tree/');
        
        sendProgressUpdate(`Processing ${selectedId} (${completedItems + 1}/${totalItems})...`, 
                         Math.round((completedItems / totalItems) * 50));
        
        if (isDirectory) {
          // Extract directory path from URL
          const urlParts = href.split('/tree/');
          if (urlParts.length > 1) {
            const pathParts = urlParts[1].split('/');
            const branch = pathParts[0];
            const dirPath = pathParts.slice(1).join('/');
            
            const dirRepoInfo = { ...repoInfo, branch };
            
            // Download directory recursively
            await processDirectoryConcurrent(
              dirRepoInfo,
              dirPath,
              zip,
              dirPath,
              (progress) => {
                if (progress?.type === 'progress') {
                  sendProgressUpdate(`Processing ${selectedId}: ${progress.completed || 0} files downloaded`);
                }
              }
            );
          }
        } else {
          // Download individual file
          const urlParts = href.split('/blob/');
          if (urlParts.length > 1) {
            const pathParts = urlParts[1].split('/');
            const branch = pathParts[0];
            const filePath = pathParts.slice(1).join('/');
            
            const fileRepoInfo = { ...repoInfo, branch };
            const fileData = await downloadFile(fileRepoInfo, filePath);
            zip.file(selectedId, fileData);
          }
        }
        
        completedItems++;
      } catch (error) {
        console.error(`Failed to download ${selectedId}:`, error);
        failedItems++;
      }
    }
    
    sendProgressUpdate("Creating ZIP file...", 75);
    
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (metadata) => {
      sendProgressUpdate(`Creating ZIP: ${Math.round(metadata.percent)}%`, 75 + (metadata.percent * 0.2));
    });
    
    const fileName = selectedIds.length === 1 ? 
      `${selectedIds[0]}.zip` : 
      `selected_items_${Date.now()}.zip`;
    
    await triggerDownload(zipBlob, fileName);
    
    const message = failedItems > 0 ? 
      `Download completed with ${failedItems} failed items` : 
      "Download completed successfully!";
    
    sendProgressUpdate(message, 100);
    
  } catch (error) {
    console.error("Download failed:", error);
    sendProgressUpdate(`Download failed: ${error.message}`);
  }
}

async function triggerDownload(zipBlob, fileName) {
  try {
    // Fallback to direct download (now primary method)
    console.log(`Triggering direct download for ${fileName}, size: ${utils.formatBytes(zipBlob.size)}`);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = utils.sanitizeFilename(fileName); // Ensure filename is sanitized
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log(`Direct download initiated for ${fileName}`);
      sendProgressUpdate(`Download initiated for ${fileName}! Check downloads.`, 100);
    }, 100);

  } catch (error) {
    console.error("Error triggering direct download:", error);
    sendProgressUpdate(`Error: Could not initiate download - ${error.message}`);
    // Optionally, re-throw or handle further if direct download itself fails
    // For example, try to use background script as a last resort if direct fails critically
  }
}

function downloadRepository(repoInfo) {
  console.log("Downloading full repository:", repoInfo);
  initializeStatusElement();
  sendProgressUpdate("Downloading full repository...");
  
  if (repoInfo.subdirectory && repoInfo.subdirectory.trim() !== '') {
    // Download subdirectory
    handleSubdirectoryDownload(repoInfo);
  } else {
    // Download full repository
    const archiveUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
    
    // Try to use the background script for downloading to avoid CORS issues
    chrome.runtime.sendMessage({
      action: "downloadRepositoryZip",
      url: archiveUrl,
      filename: `${repoInfo.repo}-${repoInfo.branch}.zip`
    }, (response) => {
      if (response?.success && response.blobId) { // Ensure blobId is present
        sendProgressUpdate("Repository ZIP fetched by background script. Preparing download...");
        
        // Get the blob from background script
        chrome.runtime.sendMessage({
          action: "requestDownloadBlob", // This action needs to retrieve the actual Blob object
          blobId: response.blobId
        }, (blobResponse) => {
          if (blobResponse?.success && blobResponse.blob instanceof Blob) {
            console.log("Blob retrieved from background, triggering direct download.");
            triggerDirectDownload(blobResponse.blob, response.filename); // Use a new function for clarity
            sendProgressUpdate("Repository download initiated!", 100);
          } else {
            console.error("Failed to retrieve blob from background or blob is invalid:", blobResponse?.error);
            sendProgressUpdate(`Error: Failed to retrieve repository ZIP data from background. ${blobResponse?.error || ''}`);
            // Fallback to trying to download the archiveUrl directly if background retrieval fails
            console.log("Falling back to direct link download for repository ZIP.");
            triggerDirectDownloadFromUrl(archiveUrl, `${repoInfo.repo}-${repoInfo.branch}.zip`);
          }
        });
      } else {
        console.error("Background downloadRepositoryZip failed or no blobId:", response?.error);
        sendProgressUpdate(`Error: Background download failed. ${response?.error || 'Attempting direct link.'}`);
        // Fallback to direct download using the URL
        triggerDirectDownloadFromUrl(archiveUrl, `${repoInfo.repo}-${repoInfo.branch}.zip`);
      }
    });
  }
}

// Renamed the old triggerDirectDownload to avoid confusion with the new primary triggerDownload(blob, filename)
function triggerDirectDownloadFromUrl(url, filename) {
  sendProgressUpdate("Using direct URL download as fallback...");
  console.log(`Attempting to download directly from URL: ${url}`);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = utils.sanitizeFilename(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
    sendProgressUpdate(`Direct URL download for ${filename} initiated! Check downloads.`, 100);
  } catch (e) {
    sendProgressUpdate(`Direct URL download for ${filename} failed. ${e.message}`, 0);
    console.error("Error clicking download link: ", e);
  }
  
  setTimeout(() => {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
  }, 100);
}

// New function to handle blobs from background script
function triggerDirectDownload(blob, filename) { // Note: This function name was already used, ensure it's the one for Blob
  if (!(blob instanceof Blob)) {
    console.error("triggerDirectDownload received invalid blob:", blob);
    sendProgressUpdate("Error: Invalid data for download.", 0);
    return;
  }
  sendProgressUpdate(`Preparing direct download for ${filename}...`);
  console.log(`Triggering direct download for blob: ${filename}, size: ${utils.formatBytes(blob.size)}`);
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = utils.sanitizeFilename(filename);
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
    sendProgressUpdate(`Download for ${filename} initiated! Check downloads.`, 100);
  } catch (e) {
    sendProgressUpdate(`Download for ${filename} failed. ${e.message}`, 0);
    console.error("Error clicking download link: ", e);
  }
  
  setTimeout(() => {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }, 100);
}

// Selection management functions
function toggleSelectionMode() {
  // For backwards compatibility, but checkboxes are always visible now
  console.log("Selection mode toggled (checkboxes are always visible)");
}

function clearAllSelections() {
  selectedItems.clear();
  document.querySelectorAll('.file-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  updateMainDownloadButton();
  updateSelectAllButton();
}

function selectAllItems() {
  const fileRows = getFileRows();
  
  fileRows.forEach(row => {
    const checkbox = row.querySelector('.file-checkbox');
    const itemData = getRowItemData(row);
    
    if (checkbox && itemData) {
      checkbox.checked = true;
      selectedItems.set(itemData.path, itemData);
    }
  });
  
  updateMainDownloadButton();
  updateSelectAllButton();
}

function unselectAllItems() {
  clearAllSelections();
}

function toggleItemSelection(itemData, checked) {
  if (checked) {
    console.log(`[GRD] Selecting: ${itemData.path}`);
    selectedItems.set(itemData.path, itemData);
  } else {
    console.log(`[GRD] Deselecting: ${itemData.path}`);
    selectedItems.delete(itemData.path);
  }
  updateMainDownloadButton();
  updateSelectAllButtonState(); // Renamed
}

function updateMainDownloadButton() {
  if (!mainDownloadButton) return;
  
  const buttonElement = mainDownloadButton.querySelector('a') || mainDownloadButton.querySelector('button');
  if (!buttonElement) return;
  
  const selectedCount = selectedItems.size;
  const span = buttonElement.querySelector('span[data-content]') || buttonElement.querySelector('span');
  
  if (selectedCount === 0) {
    if (span) {
      span.textContent = 'Download Repository';
    } else {
      buttonElement.textContent = 'Download Repository';
    }
    buttonElement.style.backgroundColor = '#2ea44f';
  } else {
    const text = selectedCount === 1 ? 
      `Download Selected (1 item)` : 
      `Download Selected (${selectedCount} items)`;
    
    if (span) {
      span.textContent = text;
    } else {
      buttonElement.textContent = text;
    }
    buttonElement.style.backgroundColor = '#0969da';
  }
}

function updateSelectAllButton() {
  if (!selectAllButton) return;
  
  const fileRows = getFileRows();
  const checkboxes = document.querySelectorAll('.file-checkbox');
  const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
  
  // Show/hide the select all button based on whether any checkboxes are checked
  const anyChecked = checkedBoxes.length > 0;
  selectAllButton.style.display = anyChecked ? 'inline-block' : 'none';
  
  if (checkedBoxes.length === 0) {
    selectAllButton.textContent = 'Select All';
  } else if (checkedBoxes.length === checkboxes.length && checkboxes.length > 0) {
    selectAllButton.textContent = 'Unselect All';
  } else {
    selectAllButton.textContent = `Select All (${checkedBoxes.length}/${checkboxes.length})`;
  }
}

function updateSelectionUI() {
  // This function is now mainly for ensuring the select all button state is correct
  // as checkboxes are always visible.
  console.log("[GRD] updateSelectionUI called (primarily updates select all button).");
  updateSelectAllButtonState();
}

// File row detection and data extraction
function getFileRows() {
  console.log("[GRD] getFileRows called.");
  const selectors = [
    '.js-details-container[data-hpc] > .Box > [role="row"]', // Modern UI (e.g. code view file list)
    '.js-details-container > .Box > [role="row"]', // A slightly more general version
    '.js-navigation-container .js-navigation-item[role="row"]', // Older UI file lists
    'div[role="grid"] div[role="rowgroup"] div[role="row"]', // Generic grid structure
    '.react-directory-row', // React-based directory view
    '.Box-row[role="row"]' // Common Box row pattern used for file listings
  ];
  
  let fileRows = [];
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length > 0) {
      console.log(`[GRD] Found ${elements.length} potential rows with selector: ${selector}`);
      fileRows = elements.filter(row => {
        const isHeaderRow = row.matches('[role="columnheader"], .react-directory-header-row') || row.querySelector('[role="columnheader"]');
        const hasFileLink = row.querySelector('a[href*="/blob/"], a[href*="/tree/"], [data-testid="fs-entry-icon"] + a');
        const isSubmoduleEntry = row.querySelector('.octicon-file-submodule');

        if (isHeaderRow) return false;
        if (isSubmoduleEntry) { // Often don't want to select submodules this way
            // console.log("[GRD] Filtering out submodule row:", row);
            return false; 
        }
        return hasFileLink !== null;
      });
      if (fileRows.length > 0) {
        console.log(`[GRD] Filtered to ${fileRows.length} actual file rows using: ${selector}`);
        break; 
      }
    }
  }
  
  if (fileRows.length === 0) {
    console.warn("[GRD] No file rows found with any primary selector. This might be an unsupported page structure or empty directory.");
  }
  return fileRows;
}

function getRowItemData(row) {
  const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
  if (!link) return null;
  
  let href = link.href || link.getAttribute('href');
  if (!href) return null;
  
  if (!href.startsWith('http')) {
    href = new URL(href, window.location.origin).href;
  }
  
  const isDirectory = href.includes('/tree/');
  const name = link.textContent.trim();
  const repoInfo = extractRepositoryInfo(window.location.href);
  
  if (!repoInfo) return null;
  
  let branch = repoInfo.branch;
  let path = '';
  
  try {
    if (isDirectory) {
      const treeParts = href.split('/tree/');
      if (treeParts.length > 1) {
        const pathWithBranch = treeParts[1];
        const parts = pathWithBranch.split('/');
        branch = parts[0];
        path = parts.slice(1).join('/');
      }
    } else {
      const blobParts = href.split('/blob/');
      if (blobParts.length > 1) {
        const pathWithBranch = blobParts[1];
        const parts = pathWithBranch.split('/');
        branch = parts[0];
        path = parts.slice(1).join('/');
      }
    }
  } catch (error) {
    console.error("Error parsing URL:", error);
    return null;
  }
  
  return {
    name,
    path,
    href,
    isDirectory,
    type: isDirectory ? 'directory' : 'file',
    repoInfo: { ...repoInfo, branch },
    fullPath: path
  };
}

// Create and manage selection interface
function addCheckboxesToFileRows() {
  console.log("[GRD] Attempting to add/update checkboxes...");
  if (!window.location.hostname.includes('github.com')) {
    console.log("[GRD] Not a GitHub domain. Skipping checkboxes.");
    return;
  }

  const repoInfo = extractRepositoryInfo(window.location.href);
  if (!repoInfo) {
    console.log("[GRD] No repo info found. Skipping checkboxes.");
    return;
  }

  // Check if we are on a page that should have file listings
  // (e.g., /tree/main, or the root of a repo)
  const path = window.location.pathname;
  const isFileListingPage = path.includes('/tree/') || /^\/[^\/]+\/[^\/]+\/?(?:$|\/(?:tree\/[^\/]+)?)$/.test(path);

  if (!isFileListingPage) {
    console.log("[GRD] Not a file listing page. Path:", path, "Skipping checkboxes.");
    // Clear any existing checkboxes if we navigate away from a file listing page
    document.querySelectorAll('.file-checkbox, .github-select-all-btn').forEach(el => el.remove());
    if (selectAllButton) selectAllButton.style.display = 'none';
    return;
  }
  console.log("[GRD] On a file listing page. Proceeding with checkboxes.");

  addCheckboxStyles(); // Ensure styles are present

  const fileRows = getFileRows();
  if (fileRows.length === 0) {
    console.log("[GRD] No file rows found by getFileRows. Checkbox addition aborted for now.");
    return;
  }
  console.log(`[GRD] Found ${fileRows.length} file rows. Adding checkboxes...`);

  // Create select all button if it doesn't exist
  if (!selectAllButton || !document.body.contains(selectAllButton)) {
    selectAllButton = createSelectAllButton(); // createSelectAllButton handles appending
  }

  fileRows.forEach((row, index) => {
    // Skip if checkbox already exists on this specific row
    if (row.querySelector('.file-checkbox')) {
      // console.log(`[GRD] Checkbox already exists for row ${index}.`);
      return;
    }

    const itemData = getRowItemData(row);
    if (!itemData) {
      console.warn(`[GRD] Could not get item data for row ${index}:`, row);
      return;
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'file-checkbox';
    checkbox.dataset.path = itemData.path;
    checkbox.dataset.name = itemData.name;
    checkbox.dataset.type = itemData.isDirectory ? 'directory' : 'file'; // Use isDirectory
    checkbox.checked = selectedItems.has(itemData.path); // Sync with current selection state

    // Style the checkbox (some styles in CSS, some here for dynamic parts)
    Object.assign(checkbox.style, {
      // position: 'absolute', // Let CSS handle this if possible for better flow
      // left: '8px',
      // top: '50%',
      // transform: 'translateY(-50%)',
      // zIndex: '20', // Let CSS handle
      // width: '16px', // In CSS
      // height: '16px', // In CSS
      cursor: 'pointer',
      display: 'inline-block', // Make sure it's visible
      verticalAlign: 'middle',
      marginRight: '8px', // Space between checkbox and icon/text
      opacity: checkbox.checked ? '1' : '0.6' // Initial opacity
    });
    
    checkbox.addEventListener('mouseenter', () => { checkbox.style.opacity = '1'; });
    checkbox.addEventListener('mouseleave', () => { checkbox.style.opacity = checkbox.checked ? '1' : '0.6'; });

    checkbox.addEventListener('change', (e) => {
      e.stopPropagation(); // Prevent row click if any
      checkbox.style.opacity = checkbox.checked ? '1' : '0.6';
      toggleItemSelection(itemData, checkbox.checked);
      updateSelectAllButtonState(); // Renamed for clarity
    });
    
    // Injection Point:
    // Try to find the cell with the file icon or name.
    // GitHub structure: usually a div with class 'react-directory-filename-column', or similar.
    // Or the first 'td' or '[role="gridcell"]'
    let injectionTarget = row.querySelector('td:first-of-type, [role="gridcell"]:first-of-type, .react-directory-filename-column');
    
    if (injectionTarget) {
        // Prepend checkbox to keep it to the left of the icon/text
        injectionTarget.style.position = 'relative'; // Ensure z-index works if needed
        // Check if a link or main content element exists to prepend before
        const firstLinkOrIcon = injectionTarget.querySelector('svg, a, .react-file-icon__root');
        if (firstLinkOrIcon) {
            firstLinkOrIcon.parentNode.insertBefore(checkbox, firstLinkOrIcon);
        } else {
            injectionTarget.prepend(checkbox);
        }
        // console.log(`[GRD] Added checkbox to ${itemData.name} in target:`, injectionTarget);
    } else {
      // Fallback: prepend to the row itself if no better target found
      row.prepend(checkbox);
      console.warn(`[GRD] Used fallback injection for checkbox in row ${index}:`, row);
    }
  });

  updateMainDownloadButton();
  updateSelectAllButtonState(); // Renamed for clarity
  console.log(`[GRD] Finished adding/updating checkboxes. Total on page: ${document.querySelectorAll('.file-checkbox').length}`);
}

function addCheckboxStyles() {
  const styleId = 'github-repo-downloader-checkbox-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .file-checkbox {
      appearance: none;
      background-color: #fff;
      border: 1px solid #d0d7de; /* Standard GitHub border color */
      border-radius: 3px;
      width: 16px;
      height: 16px;
      position: relative; /* For pseudo-elements like checkmark */
      cursor: pointer;
      transition: all 0.15s ease;
      vertical-align: middle; /* Align with text/icons */
      margin-right: 8px; /* Space from icon/name */
      flex-shrink: 0; /* Prevent shrinking in flex containers */
    }
    .file-checkbox:checked {
      background-color: #0969da; /* GitHub blue */
      border-color: #0969da;
      opacity: 1 !important;
    }
    .file-checkbox:checked::before {
      content: '✓';
      color: white;
      font-size: 12px;
      font-weight: bold;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      line-height: 1;
    }
    .file-checkbox:hover {
      border-color: #0969da;
      opacity: 1 !important;
      /* transform: scale(1.1); */ /* Can cause layout shifts, be careful */
    }
    .github-select-all-btn {
      transition: all 0.2s ease;
    }
    .github-select-all-btn:hover {
      background-color: #f3f4f6 !important;
      /* transform: translateY(-1px); */ /* Can cause layout shifts */
    }
    
    /* Adjustments for common GitHub file row structures */
    /* Ensure cells that will contain checkboxes can do so cleanly */
    [role="row"] > [role="gridcell"]:first-of-type, 
    .Box-row > td:first-of-type,
    .react-directory-row > .react-directory-filename-column {
        display: flex; /* Helps align checkbox with icon/text */
        align-items: center;
        /* padding-left: 0 !important; */ /* Reset padding if needed, checkbox adds margin */
    }

    /* Remove excessive padding if checkbox is directly in these containers */
    /* This might be too aggressive, test carefully */
    /*
    .react-directory-filename a,
    .js-navigation-open,
    [role="gridcell"]:first-child a {
      padding-left: 0px !important; 
    }
    */
  `;
  document.head.appendChild(style);
  console.log("[GRD] Checkbox styles added.");
}

// ... existing code ...
function toggleItemSelection(itemData, checked) {
  if (checked) {
    console.log(`[GRD] Selecting: ${itemData.path}`);
    selectedItems.set(itemData.path, itemData);
  } else {
    console.log(`[GRD] Deselecting: ${itemData.path}`);
    selectedItems.delete(itemData.path);
  }
  updateMainDownloadButton();
  updateSelectAllButtonState(); // Renamed
}

// ... existing code ...
function updateSelectAllButtonState() { // Renamed from updateSelectAllButton
  if (!selectAllButton || !document.body.contains(selectAllButton)) {
    console.log("[GRD] updateSelectAllButtonState: No selectAllButton found or not in DOM.");
    return;
  }
  
  const checkboxes = document.querySelectorAll('.file-checkbox');
  const checkedBoxes = document.querySelectorAll('.file-checkbox:checked');
  
  const totalCheckboxesOnPage = checkboxes.length;
  const totalChecked = checkedBoxes.length;

  if (totalCheckboxesOnPage === 0) {
    selectAllButton.style.display = 'none'; // Hide if no checkboxes on page
    console.log("[GRD] No checkboxes on page, hiding selectAllButton.");
    return;
  }

  // Show "Select All" button if there are items to select,
  // and make it more prominent if some items are already selected.
  selectAllButton.style.display = 'inline-block';
  
  if (totalChecked === 0) {
    selectAllButton.textContent = 'Select All';
  } else if (totalChecked === totalCheckboxesOnPage) {
    selectAllButton.textContent = 'Unselect All';
  } else {
    selectAllButton.textContent = `Selected (${totalChecked}/${totalCheckboxesOnPage})`;
  }
  console.log(`[GRD] Select All Button state updated: ${selectAllButton.textContent}`);
}

// ... existing code ...
function createSelectAllButton() {
  // Remove existing if any to prevent duplicates
  const existingBtn = document.querySelector('.github-select-all-btn');
  if (existingBtn) existingBtn.remove();
  selectAllButton = null; // Reset global variable

  console.log("[GRD] Creating Select All button.");
  
  const headerSelectors = [
    // Modern GitHub UI (2023+)
    '.gh-header-actions', // Top right actions group
    '[data-testid="sticky-header"] .Box-header', // Header within sticky header
    '.repository-content .Box-header:first-of-type', // First Box-header in main content
    '.file-navigation .d-flex.justify-content-between', // File navigation bar actions area
    '.file-navigation', // Fallback within file navigation
    // Older UI / More general
    '.pagehead-actions', // Common for older UI actions
    '.Box-header', // General Box-header
    '[aria-label="Repository actions"]' // Actions group by aria-label
  ];

  let fileHeader = null;
  for (const selector of headerSelectors) {
    fileHeader = document.querySelector(selector);
    if (fileHeader) {
      console.log(`[GRD] Found file header for Select All button using selector: ${selector}`);
      break;
    }
  }
  
  if (!fileHeader) {
    // Last resort fallback: try to find *any* prominent header or action bar
    fileHeader = document.querySelector('.pagehead, header[role="banner"], #repository-container-header');
    if (fileHeader) {
        console.warn(`[GRD] Used fallback header selector for Select All button:`, fileHeader);
    } else {
        console.error("[GRD] CRITICAL: Could not find ANY suitable file header for Select All button. It will not appear.");
        return null;
    }
  }
  
  selectAllButton = document.createElement('button');
  selectAllButton.textContent = 'Select All';
  selectAllButton.className = 'btn btn-sm github-select-all-btn';
  Object.assign(selectAllButton.style, {
    marginLeft: '12px',
    marginRight: '12px',
    cursor: 'pointer',
    display: 'none' // Initially hidden, shown by updateSelectAllButtonState
  });
  
  selectAllButton.addEventListener('click', (e) => {
    e.preventDefault();
    const allCheckboxes = document.querySelectorAll('.file-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
    
    if (checkedCheckboxes.length === allCheckboxes.length && allCheckboxes.length > 0) {
      console.log("[GRD] Unselecting all items via Select All button.");
      unselectAllItems();
    } else {
      console.log("[GRD] Selecting all items via Select All button.");
      selectAllItems();
    }
  });
  
  // Append to the found header. If it has other buttons, try to insert it logically.
  const existingButtons = fileHeader.querySelectorAll('.btn, .Button');
  if (existingButtons.length > 0 && existingButtons[0].parentNode === fileHeader) {
    // Insert before the first button if possible to group it with other actions
    fileHeader.insertBefore(selectAllButton, existingButtons[0]);
    console.log("[GRD] Select All button inserted before first existing button in header.");
  } else {
    fileHeader.appendChild(selectAllButton);
    console.log("[GRD] Select All button appended to header.");
  }
  
  return selectAllButton;
}

// GitHub Checkbox Overlay Extension Content Script - Fixed positioning approach

const SELECTORS = [
  '[role="row"]', // Any GitHub row
  '.js-navigation-item', // Legacy repo navigation  
  '.Box-row', // Box rows
  '.react-directory-row', // React directory rows
  'tr', // Table rows
];
const OVERLAY_CLASS = 'ghx-chk-ovl';
const BULK_BAR_ID = 'ghx-bulk-bar';
const STORAGE_KEY = () => 'ghx_' + location.pathname.replace(/[^a-zA-Z0-9_/-]/g, '_');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function getRows() {
  return SELECTORS.flatMap(sel => $$(sel)).filter(row => {
    // Must be visible
    if (!row.offsetParent) return false;
    
    // Exclude header rows - comprehensive check
    const isHeader = row.querySelector('[role="columnheader"]') || 
                    row.matches('[role="columnheader"]') ||
                    row.classList.contains('react-directory-header-row') ||
                    row.classList.contains('Box-header') ||
                    row.querySelector('th') ||
                    row.matches('th') ||
                    row.querySelector('.sr-only') ||
                    (row.textContent && row.textContent.trim().toLowerCase().includes('name')) && 
                    !row.querySelector('a[href*="/blob/"], a[href*="/tree/"]') ||
                    row.getAttribute('aria-label')?.toLowerCase().includes('header') ||
                    row.classList.contains('file-header') ||
                    row.classList.contains('js-details-target');
    
    if (isHeader) return false;
    
    // Must have a file or folder link OR be in a file listing area
    const hasFileLink = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
    const inFileArea = row.closest('.js-details-container, .repository-content');
    
    if (!hasFileLink && !inFileArea) return false;
    
    // If has file link, exclude ".." directory
    if (hasFileLink) {
      const linkText = hasFileLink.textContent.trim();
      if (linkText === '..' || linkText === '...' || linkText.includes('parent directory')) return false;
    }
    
    // Additional check: if row contains only text without links, likely a header
    if (!hasFileLink && row.textContent.trim().length < 100 && 
        (row.textContent.includes('Name') || row.textContent.includes('Size') || row.textContent.includes('Last commit'))) {
      return false;
    }
    
    return true;
  });
}

function injectStyles() {
  if ($('#ghx-style')) return;
  const s = document.createElement('style');
  s.id = 'ghx-style';
  s.textContent = `
    .ghx-fixed-checkbox {
      position: fixed !important;
      width: 16px !important;
      height: 16px !important;
      appearance: none !important;
      background-color: var(--bgColor-default, #fff) !important;
      border: 1.5px solid var(--borderColor-default, #d0d7de) !important;
      border-radius: 4px !important;
      cursor: pointer !important;
      transition: all .15s ease !important;
      z-index: 2147483647 !important;
      display: block !important;
      pointer-events: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .ghx-fixed-checkbox:checked {
      background: var(--color-accent-emphasis, #0969da) !important;
      border-color: var(--color-accent-emphasis, #0969da) !important;
    }
    .ghx-fixed-checkbox:checked::after {
      content: '✓' !important;
      color: white !important;
      font-size: 11px !important;
      font-weight: bold !important;
      position: absolute !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      line-height: 1 !important;
    }
    .ghx-fixed-checkbox:hover {
      border-color: var(--color-accent-emphasis, #0969da) !important;
      box-shadow: 0 0 0 2px var(--color-accent-subtle, #b6e3ff) !important;
    }
    #${BULK_BAR_ID} {
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:var(--color-canvas-default, #fff);color:var(--color-fg-default, #222);
      border:1px solid var(--color-border-default, #d0d7de);border-radius:12px;
      box-shadow:var(--color-shadow-large, 0 8px 24px rgba(0,0,0,0.12));
      padding:12px 24px;z-index:2147483647;display:flex;align-items:center;gap:16px;
      font-size:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    #${BULK_BAR_ID} button {
      background:var(--color-btn-primary-bg, #1f883d);color:var(--color-btn-primary-text, #fff);
      border:1px solid var(--color-btn-primary-border, transparent);border-radius:6px;
      padding:6px 16px;cursor:pointer;font-weight:500;transition:all .2s;font-size:14px;
    }
    #${BULK_BAR_ID} button:hover { 
      background:var(--color-btn-primary-hover-bg, #1a7f37); 
    }
  `;
  document.head.appendChild(s);
}

let checkboxElements = new Map(); // Track checkbox elements by row

function injectCheckboxes() {
  const rows = getRows();
  console.log(`Found ${rows.length} rows to inject checkboxes into`);
  
  // Remove checkboxes for rows that no longer exist
  const currentRows = new Set(rows);
  for (const [row, checkbox] of checkboxElements.entries()) {
    if (!currentRows.has(row)) {
      checkbox.remove();
      checkboxElements.delete(row);
    }
  }
  
  loadState().then(state => {
    const selected = new Set(Object.keys(state).filter(k => state[k]));
    
    rows.forEach((row, index) => {
      let id = getId(row);
      if (!id) {
        console.log(`Skipping row ${index} - no ID`);
        return;
      }
      
      // If checkbox already exists for this row, just update its position and state
      if (checkboxElements.has(row)) {
        const checkbox = checkboxElements.get(row);
        updateCheckboxPosition(checkbox, row);
        checkbox.checked = selected.has(id);
        return;
      }
      
      console.log(`Injecting fixed checkbox for row ${index}: ${id}`);
      
      // Create checkbox with fixed positioning
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'ghx-fixed-checkbox';
      chk.checked = selected.has(id);
      chk.tabIndex = 0;
      chk.setAttribute('aria-label', `Select ${id}`);
      chk.onclick = e => {
        e.stopPropagation();
        onCheckboxChange(id, chk.checked, e);
      };
      
      // Calculate and set position
      updateCheckboxPosition(chk, row);
      
      // Add to document body (not inside the table)
      document.body.appendChild(chk);
      checkboxElements.set(row, chk);
    });
    
    updateBulkBar(selected, rows.length);
  });
}

function updateCheckboxPosition(checkbox, row) {
  try {
    const rect = row.getBoundingClientRect();
    
    // For position: fixed, getBoundingClientRect() already gives viewport-relative coordinates
    // No need to add scroll offsets
    checkbox.style.left = (rect.left + 8) + 'px';
    checkbox.style.top = (rect.top + (rect.height / 2) - 8) + 'px';
  } catch (error) {
    console.error('Error updating checkbox position:', error);
  }
}

function updateAllCheckboxPositions() {
  for (const [row, checkbox] of checkboxElements.entries()) {
    updateCheckboxPosition(checkbox, row);
  }
}

function getId(row) {
  const link = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
  if (link) {
    const href = link.getAttribute('href') || link.href;
    const filename = link.textContent.trim();
    // Use filename as ID, fallback to URL parts
    return filename || href.split('/').pop() || 'unknown';
  }
  return row.dataset.path || row.dataset.issueId || row.dataset.id || row.getAttribute('id') || row.innerText.trim().substring(0, 50);
}

async function saveState(state) {
  chrome.storage.local.set({ [STORAGE_KEY()]: state });
}
async function loadState() {
  return new Promise(res =>
    chrome.storage.local.get([STORAGE_KEY()], r => res(r[STORAGE_KEY()] || {}))
  );
}

async function updateBulkBar(selected, total) {
  let bar = $(`#${BULK_BAR_ID}`);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BULK_BAR_ID;
    document.body.appendChild(bar);
  }
  
  // Check current state from actual checkboxes
  const checkedBoxes = Array.from(checkboxElements.values()).filter(cb => cb.checked);
  const totalBoxes = checkboxElements.size;
  const allSelected = checkedBoxes.length === totalBoxes && totalBoxes > 0;
  
  console.log(`UpdateBulkBar: ${checkedBoxes.length}/${totalBoxes} checkboxes checked, allSelected=${allSelected}`);
  
  const buttonText = allSelected ? 'Deselect All' : 'Select All';
  
  bar.innerHTML = `
    <b>${checkedBoxes.length}</b> selected
    <button id="ghx-sel-all">${buttonText}</button>
  `;
  
  $('#ghx-sel-all', bar).onclick = () => {
    console.log(`Select All button clicked: will ${allSelected ? 'deselect' : 'select'} all`);
    toggleSelectAll(!allSelected);
  };
  
  bar.style.display = totalBoxes > 0 ? 'flex' : 'none';
  
  // Update main download button text
  updateMainDownloadButtonText(checkedBoxes.length);
}

function updateMainDownloadButtonText(selectedCount) {
  if (!mainDownloadButton) return;
  
  const buttonElement = mainDownloadButton.querySelector('a') || mainDownloadButton.querySelector('button');
  if (!buttonElement) return;
  
  const span = buttonElement.querySelector('span[data-content]') || buttonElement.querySelector('span');
  
  if (selectedCount === 0) {
    if (span) {
      span.textContent = 'Download Repository';
    } else {
      buttonElement.textContent = 'Download Repository';
    }
    buttonElement.style.backgroundColor = '#2ea44f';
  } else {
    const text = selectedCount === 1 ? 
      `Download Selected (1 item)` : 
      `Download Selected (${selectedCount} items)`;
    
    if (span) {
      span.textContent = text;
    } else {
      buttonElement.textContent = text;
    }
    buttonElement.style.backgroundColor = '#0969da';
  }
}

async function toggleSelectAll(selectAll) {
  console.log(`toggleSelectAll called with selectAll=${selectAll}`);
  const rows = getRows();
  const state = {};
  
  // Set all items to the desired state
  rows.forEach(row => {
    let id = getId(row);
    if (id) {
      state[id] = selectAll;
    }
  });
  
  await saveState(state);
  
  // Update all checkbox states
  updateAllRowStates(state);
  
  // Update bulk bar with actual checkbox counts
  const checkedBoxes = Array.from(checkboxElements.values()).filter(cb => cb.checked);
  const totalBoxes = checkboxElements.size;
  
  console.log(`After toggle: ${checkedBoxes.length}/${totalBoxes} checkboxes selected`);
  
  updateBulkBar(new Set(), totalBoxes);
}

async function onCheckboxChange(id, checked, e) {
  console.log(`Checkbox changed: ${id} = ${checked}`);
  const state = await loadState();
  
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    // Multi-select: select all between last and this
    const rows = getRows();
    const ids = rows.map(getId);
    const lastIdx = ids.findIndex(i => state[i]);
    const thisIdx = ids.indexOf(id);
    if (lastIdx !== -1 && thisIdx !== -1) {
      const [from, to] = [lastIdx, thisIdx].sort((a, b) => a - b);
      for (let i = from; i <= to; i++) state[ids[i]] = true;
    }
  } else {
    state[id] = checked;
  }
  
  await saveState(state);
  
  // Update all visual states
  updateAllRowStates(state);
  updateBulkBar(new Set(), checkboxElements.size);
}

function updateAllRowStates(state) {
  const rows = getRows();
  rows.forEach(row => {
    const id = getId(row);
    const isSelected = state[id] || false;
    
    // Update checkbox state
    const checkbox = checkboxElements.get(row);
    if (checkbox) {
      checkbox.checked = isSelected;
    }
  });
}

function observe() {
  let lastUrl = location.href;
  const reinit = () => {
    setTimeout(() => {
      injectCheckboxes();
      updateAllCheckboxPositions();
    }, 100);
  };
  
  // Watch for URL changes and DOM changes
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Clear old checkboxes on URL change
      for (const checkbox of checkboxElements.values()) {
        checkbox.remove();
      }
      checkboxElements.clear();
      reinit();
    } else {
      // Update positions on DOM changes (but debounced)
      clearTimeout(observe.positionTimeout);
      observe.positionTimeout = setTimeout(updateAllCheckboxPositions, 25); // Faster DOM updates
    }
  }).observe(document.body, { childList: true, subtree: true });
  
  // High-frequency position updates using requestAnimationFrame
  let isScrolling = false;
  let isResizing = false;
  let animationFrame = null;
  
  function schedulePositionUpdate() {
    if (animationFrame) return; // Already scheduled
    
    animationFrame = requestAnimationFrame(() => {
      updateAllCheckboxPositions();
      animationFrame = null;
      
      // Continue updating while scrolling/resizing
      if (isScrolling || isResizing) {
        schedulePositionUpdate();
      }
    });
  }
  
  // Scroll events - immediate response
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    isScrolling = true;
    schedulePositionUpdate();
    
    // Mark scrolling as stopped after a short delay
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 50);
  }, { passive: true });
  
  // Resize events - immediate response
  let resizeTimeout;
  window.addEventListener('resize', () => {
    isResizing = true;
    schedulePositionUpdate();
    
    // Mark resizing as stopped after a short delay
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      isResizing = false;
    }, 100);
  }, { passive: true });
  
  // Additional events that might affect positioning
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      isResizing = true;
      schedulePositionUpdate();
      setTimeout(() => { isResizing = false; }, 200);
    }, 100);
  });
  
  // Handle zoom changes
  let lastInnerWidth = window.innerWidth;
  let lastInnerHeight = window.innerHeight;
  setInterval(() => {
    if (window.innerWidth !== lastInnerWidth || window.innerHeight !== lastInnerHeight) {
      lastInnerWidth = window.innerWidth;
      lastInnerHeight = window.innerHeight;
      isResizing = true;
      schedulePositionUpdate();
      setTimeout(() => { isResizing = false; }, 100);
    }
  }, 100); // Check for zoom/viewport changes every 100ms
  
  reinit();
}

// --- Init ---
injectStyles();
observe();