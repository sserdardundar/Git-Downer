// This content script runs in the context of GitHub pages
// Configuration options
const CONFIG = {
  useOptimizedDownload: true,  // Set to false to force legacy download method
  debugMode: true,             // Enable detailed logging
  maxRepositorySizeMB: 200,    // Max repository size to use optimized method (in MB)
  downloadTimeoutMs: 120000,    // Timeout for repository download (120 seconds)
  showIconButtons: true        // Enable file/folder icon download buttons
};

let jsZip = null;
let jsZipLoaded = false;

// Global reference to the status element
let statusElement = null;

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

// Embed a minimal version of JSZip directly to avoid loading issues
// This will act as a fallback if external loading fails
const JSZipMinimal = `
// Minimal JSZip implementation when full version fails to load
class JSZipMinimal {
  constructor() {
    this.files = {};
    this.root = '';
  }

  folder(name) {
    return {
      file: (filename, content) => {
        // Store file in memory with folder path
        const path = name ? name + '/' + filename : filename;
        this.files[path] = content;
        return true;
      },
      folder: (subName) => {
        // Create nested folder
        const fullPath = name ? name + '/' + subName : subName;
        return {
          file: (filename, content) => {
            const path = fullPath + '/' + filename;
            this.files[path] = content;
            return true;
          },
          folder: () => null // Limited support for deep nesting
        };
      }
    };
  }

  file(name, content) {
    this.files[name] = content;
    return true;
  }

  async generateAsync() {
    // Since we can't create a zip, we'll create a single file with metadata
    const fileList = Object.keys(this.files).map(name => ({
      name,
      size: this.files[name].byteLength || this.files[name].length || 0
    }));
    
    const metadata = {
      message: "JSZip wasn't able to load properly. Individual files will be downloaded separately.",
      files: fileList
    };
    
    // Just create a text file with the file listing
    const textEncoder = new TextEncoder();
    const metadataContent = textEncoder.encode(JSON.stringify(metadata, null, 2));
    
    return new Blob([metadataContent], { type: 'application/json' });
  }
}
`;

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

// Function to add download button to GitHub UI
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
      console.log("Download button clicked");
      
      // Extract repository information from the current URL
      const repoInfo = extractRepositoryInfo(window.location.href);
      if (!repoInfo) {
        console.error("Failed to extract repository information from URL");
        alert("Unable to determine repository information from URL");
        return;
      }
      
      // Call downloadSubdirectory with the extracted repository information
      downloadSubdirectory(repoInfo);
    });
    
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
async function downloadFile(repoInfo, filePath, maxRetries = 3) {
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
      
      // Try to create a direct download link
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Clean up the URL object
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      if (failedFiles > 0) {
        sendProgressUpdate(`Download complete with ${failedFiles} missing files. Archive size: ${formatFileSize(zipBlob.size)}`);
      } else {
        sendProgressUpdate(`Download complete! Archive size: ${formatFileSize(zipBlob.size)}`);
      }
    } catch (downloadError) {
      console.error("Error creating download link:", downloadError);
      
      // Fall back to Chrome's download API
      sendProgressUpdate("Using Chrome downloads API as fallback...");
      
      try {
        const reader = new FileReader();
        reader.onload = function() {
          const dataUrl = reader.result;
          chrome.runtime.sendMessage({
            action: "downloadBlob",
            dataUrl: dataUrl,
            filename: fileName
          }, response => {
            if (response.success) {
              sendProgressUpdate("Download initiated through Chrome API.");
            } else {
              sendProgressUpdate(`Error: ${response.error}`);
            }
          });
        };
        reader.readAsDataURL(zipBlob);
      } catch (chromeError) {
        console.error("Error using Chrome download API:", chromeError);
        sendProgressUpdate(`Failed to download: ${chromeError.message}`);
      }
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
        filename: `${repoInfo.repo}-${repoInfo.branch}.zip`,
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
    
    console.log(`Repository ZIP downloaded via background script, size: ${formatFileSize(result.size)}`);
    
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
    if (repositorySizeMB > CONFIG.maxRepositorySizeMB) {
      console.warn(`Repository size (${repositorySizeMB.toFixed(2)} MB) exceeds max size (${CONFIG.maxRepositorySizeMB} MB)`);
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
      console.log("JSZip loaded for extraction");
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
    
    console.log(`ZIP file generated successfully: ${formatFileSize(zipBlob.size)}`);
    
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
    
    console.log(`ZIP file generated successfully: ${formatFileSize(zipBlob.size)}`);
    
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

// Function to observe DOM changes and add the download button when navigation happens
function setupMutationObserver() {
  // Add download button on initial page load
  addDownloadButtonToUI();
  addFileDownloadButtons();

  // Create a mutation observer to watch for navigation changes
  const observer = new MutationObserver((mutations) => {
    const navChanged = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.querySelector && (
            node.querySelector('nav[aria-label="Repository"]') ||
            node.querySelector('.UnderlineNav-body') ||
            node.classList.contains('pagehead-actions')
          );
        }
        return false;
      });
    });

    if (navChanged) {
      addDownloadButtonToUI();
    }
    
    // Check if file listing has changed
    const fileListChanged = mutations.some(mutation => {
      return mutation.target && 
             (mutation.target.matches('[role="grid"]') || 
              mutation.target.matches('.js-navigation-container') ||
              mutation.target.classList.contains('js-navigation-container') ||
              mutation.target.querySelector && 
              (mutation.target.querySelector('[role="row"]') || 
               mutation.target.querySelector('.js-navigation-item') ||
               mutation.target.querySelector('.react-directory-row')));
    });
    
    if (fileListChanged) {
      setTimeout(addFileDownloadButtons, 100); // Slight delay to ensure DOM is updated
    }
  });

  // Start observing the document with the configured parameters
  observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMutationObserver);
} else {
  setupMutationObserver();
}

// Notify that the content script is loaded
console.log("GitHub Repository Downloader content script loaded");

// Process a directory concurrently, downloading all files with limited concurrency
async function processDirectoryConcurrent(repoInfo, currentDirPath, zip, basePath, progressCallback, maxConcurrent = 10) {
  console.log(`Processing directory: ${currentDirPath}`);
  
  try {
    // Get directory contents from GitHub API
    const apiUrl = getDirectoryApiUrl(repoInfo, currentDirPath);
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      console.error(`Failed to get directory contents: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to get directory contents: ${response.status}`);
    }
    
    const contents = await response.json();
    console.log(`Found ${contents.length} items in ${currentDirPath || 'root'}`);
    
    // Count total files and directories
    let totalFiles = 0;
    let directories = [];
    
    for (const item of contents) {
      if (item.type === 'file') {
        totalFiles++;
      } else if (item.type === 'dir') {
        directories.push(item.path);
      }
    }
    
    // Prepare for concurrent downloads
    const files = contents.filter(item => item.type === 'file');
    const fileChunks = [];
    const chunkSize = Math.min(maxConcurrent, files.length);
    
    // Create chunks for concurrent downloading
    for (let i = 0; i < files.length; i += chunkSize) {
      fileChunks.push(files.slice(i, i + chunkSize));
    }
    
    console.log(`Downloading ${files.length} files in ${fileChunks.length} chunks of up to ${chunkSize} files`);
    
    // Track downloads
    let completedFiles = 0;
    let failedFiles = 0;
    
    // Process all file chunks
    for (let i = 0; i < fileChunks.length; i++) {
      const chunk = fileChunks[i];
      console.log(`Processing chunk ${i+1}/${fileChunks.length} (${chunk.length} files)`);
      
      // Download files in current chunk concurrently
      const chunkResults = await Promise.allSettled(chunk.map(async file => {
        try {
          // Calculate path for ZIP file relative to base path
          let relativePath = file.path;
          
          // If we have a base path, remove it from the file path for proper ZIP structure
          if (basePath && relativePath.startsWith(basePath)) {
            relativePath = relativePath.substring(basePath.length).replace(/^\/+/, '');
          }
          
          // Download the file content
          const content = await downloadFile(repoInfo, file.path);
          
          // Add file to ZIP
          zip.file(relativePath, content);
          
          completedFiles++;
          if (progressCallback) {
            progressCallback({
              type: 'progress',
              completed: completedFiles,
              failed: failedFiles,
              total: totalFiles,
              currentOperation: `Downloaded ${file.path}`
            });
          }
          
          return { success: true, path: file.path };
    } catch (error) {
          console.error(`Failed to process file ${file.path}:`, error);
          failedFiles++;
          
          if (progressCallback) {
            progressCallback({
              type: 'progress',
              completed: completedFiles,
              failed: failedFiles,
              total: totalFiles,
              currentOperation: `Failed: ${file.path} - ${error.message}`
            });
          }
          
          return { success: false, path: file.path, error: error.message };
        }
      }));
      
      // Log results for this chunk
      const succeeded = chunkResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = chunkResults.filter(r => r.status !== 'fulfilled' || !r.value.success).length;
      console.log(`Chunk ${i+1} complete: ${succeeded} succeeded, ${failed} failed`);
    }
    
    // Process subdirectories sequentially to avoid overwhelming the API
    for (const dirPath of directories) {
      // Recursive call for subdirectory
      await processDirectoryConcurrent(
        repoInfo,
        dirPath,
        zip,
        basePath,
        progressCallback,
        maxConcurrent
      );
    }
    
    return { completedFiles, failedFiles, totalFiles };
  } catch (error) {
    console.error(`Error processing directory ${currentDirPath}:`, error);
    throw error;
  }
}

// Helper function to load external scripts
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = (e) => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

// Function to add download buttons to individual file/folder icons
function addFileDownloadButtons() {
  // First check if the feature is enabled in user settings
  chrome.storage.sync.get({ showIconButtons: true }, (settings) => {
    // Exit if disabled in user settings
    if (!settings.showIconButtons) {
      console.log("File/folder icon download buttons disabled in settings");
      return;
    }
    
    // Exit if the feature is disabled in config
    if (!CONFIG.showIconButtons) return;
    
    // Check if we're on a GitHub repository file listing page
    if (!window.location.pathname.includes('tree') && !window.location.pathname.match(/^\/[^\/]+\/[^\/]+\/?$/)) {
      return;
    }
    
    console.log("Adding download buttons to file/folder icons");
    
    // Add CSS for the download buttons
    const style = document.createElement('style');
    style.textContent = `
      .github-repo-item-download-btn {
        display: none;
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--color-canvas-default, #0d1117);
        border: 1px solid var(--color-border-default, #30363d);
        border-radius: 3px;
        color: var(--color-accent-fg, #58a6ff);
        padding: 3px;
        cursor: pointer;
        z-index: 99;
        width: 20px;
        height: 20px;
        line-height: 0;
      }
      
      .github-repo-download-container:hover .github-repo-item-download-btn {
        display: block;
      }
      
      .github-repo-item-download-btn:hover {
        background: var(--color-canvas-subtle, #161b22);
      }
    `;
    document.head.appendChild(style);
    
    // Find all file and directory rows in the current view - use multiple selectors for different GitHub UI versions
    const fileRows = document.querySelectorAll('.js-navigation-item, .react-directory-row, [role="row"]');
    
    if (!fileRows || fileRows.length === 0) {
      console.log("No file rows found on this page");
      return;
    }
    
    console.log(`Found ${fileRows.length} file/directory items`);
    
    // Process each file/directory row
    fileRows.forEach(row => {
      // Skip if already has a download button
      if (row.querySelector('.github-repo-item-download-btn')) {
        return;
      }
      
      // Find the link to determine the type and path
      const fileLink = row.querySelector('a[href*="/blob/"], a[href*="/tree/"]');
      if (!fileLink) return;
      
      // Determine if it's a file or directory
      const isDirectory = fileLink.getAttribute('href').includes('/tree/');
      
      // Get the name of the file/directory
      const nameElement = row.querySelector('.js-navigation-open, [role="rowheader"] a span');
      const name = nameElement ? nameElement.textContent.trim() : fileLink.textContent.trim();
      
      // Add container class to row for hover effect
      row.classList.add('github-repo-download-container');
      
      // Ensure row has relative positioning for absolute positioning of button
      if (window.getComputedStyle(row).position === 'static') {
        row.style.position = 'relative';
      }
      
      // Create the download button
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'github-repo-item-download-btn';
      downloadBtn.setAttribute('title', `Download ${isDirectory ? 'directory' : 'file'}: ${name}`);
      
      // Download icon
      downloadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
        </svg>
      `;
      
      // Extract the file or directory path from the link
      const href = fileLink.getAttribute('href');
      const repoInfo = extractRepositoryInfo(window.location.href);
      
      // Click handler for download
      downloadBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        if (!repoInfo) {
          console.error("Failed to extract repository information");
          return;
        }
        
        console.log(`Download button clicked for ${isDirectory ? 'directory' : 'file'}: ${name}`);
        
        if (isDirectory) {
          // For directories, set subdirectory path and download
          const treeParts = href.split('/tree/');
          if (treeParts.length > 1) {
            const pathParts = treeParts[1].split('/');
            const branch = pathParts[0]; // First part is the branch
            const subdirPath = pathParts.slice(1).join('/'); // Rest is the path
            
            // Create a copy of repoInfo with the subdirectory path and branch
            const dirInfo = { 
              ...repoInfo,
              branch: branch,
              subdirectory: subdirPath 
            };
            
            console.log(`Extracted repo info: owner=${dirInfo.owner}, repo=${dirInfo.repo}, branch=${dirInfo.branch}, subdirectory=${dirInfo.subdirectory}`);
            
            // Download the subdirectory
            initializeStatusElement();
            sendProgressUpdate(`Preparing to download directory: ${name}`);
            downloadSubdirectory(dirInfo);
          }
        } else {
          // For individual files, download directly
          initializeStatusElement();
          sendProgressUpdate(`Downloading file: ${name}`);
          
          try {
            // Extract file path from href
            const blobParts = href.split('/blob/');
            if (blobParts.length > 1) {
              const pathParts = blobParts[1].split('/');
              const branch = pathParts[0]; // First part is the branch
              const filePath = pathParts.slice(1).join('/'); // Rest is the path
              
              // Create a copy of repoInfo with the correct branch
              const fileInfo = {
                ...repoInfo,
                branch: branch
              };
              
              console.log(`Extracted file info: path=${filePath}, branch=${branch}`);
              
              // Download the individual file
              const fileData = await downloadFile(fileInfo, filePath);
              if (fileData) {
                // Create a blob from the file data
                const blob = new Blob([fileData], { type: 'application/octet-stream' });
                
                // Create a download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 100);
                
                sendProgressUpdate(`Download complete: ${name}`, 100);
              } else {
                sendProgressUpdate(`Failed to download: ${name}`, 0);
              }
            }
          } catch (error) {
            console.error(`Error downloading file: ${error.message}`);
            sendProgressUpdate(`Error downloading file: ${error.message}`, 0);
          }
        }
      });
      
      // Add button to the row
      row.appendChild(downloadBtn);
    });
  });
}
