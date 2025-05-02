// This content script runs in the context of GitHub pages
let jsZip = null;
let jsZipLoaded = false;

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
      downloadSubdirectory().catch(error => {
        console.error("Download error:", error);
        alert(`Download error: ${error.message}`);
      });
    });
    
    console.log("Download button added to GitHub UI with custom styling");
  });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadSubdirectory") {
    console.log("Download subdirectory request received");
    // Start the download process
    downloadSubdirectory()
      .then((result) => {
        console.log("Download completed successfully:", result);
        sendResponse({ success: true, message: "Download complete!" });
      })
      .catch((error) => {
        console.error("Download error:", error);
        // Send error to background script
        chrome.runtime.sendMessage({
          action: "downloadError",
          message: error.message || "Download failed"
        });
        sendResponse({ success: false, message: error.message });
      });

    // Return true to indicate we'll send a response asynchronously
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

    const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
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

// Function to send progress updates
function sendProgressUpdate(message) {
  console.log("Progress update:", message);
  chrome.runtime.sendMessage({
    action: "updateProgress",
    message: message
  }).catch(error => console.warn("Error sending progress update:", error));
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

// Helper function to get API URL for GitHub contents
function getApiUrl(repoInfo, path) {
  return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${path || ''}?ref=${repoInfo.branch}`;
}

// Helper function to get a direct raw content URL for a file
function getRawContentUrl(repoInfo, filePath) {
  return `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/${filePath}`;
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

// Download a file from GitHub
async function downloadFile(repoInfo, filePath) {
  try {
    console.log(`Downloading file: ${filePath}, URL: ${getRawContentUrl(repoInfo, filePath)}`);
    
    // First try direct raw content URL
    const directUrl = getRawContentUrl(repoInfo, filePath);
    
    let response = await fetch(directUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': '*/*'
      }
    });
    
    // If that fails, try alternative methods
    if (!response.ok) {
      console.warn(`Direct download failed (${response.status}), trying API...`);
      
      // Try the GitHub API to get file info
      const apiUrl = getApiUrl(repoInfo, filePath);
      const apiResponse = await fetch(apiUrl);
      
      if (!apiResponse.ok) {
        console.error(`API request failed: ${apiResponse.status}`);
        throw new Error(`Failed to get file info from GitHub API (${apiResponse.status})`);
      }
      
      const fileInfo = await apiResponse.json();
      if (!fileInfo.download_url) {
        console.error("API response missing download_url:", fileInfo);
        throw new Error("File download URL not available");
      }
      
      // Try the download URL from API response
      console.log(`Trying download URL from API: ${fileInfo.download_url}`);
      response = await fetch(fileInfo.download_url, {
        method: 'GET',
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to download file (${response.status})`);
      }
    }
    
    // Get file content as ArrayBuffer for binary support
    const fileData = await response.arrayBuffer();
    console.log(`Downloaded ${filePath.split('/').pop()}, size: ${fileData.byteLength} bytes`);
    
    return fileData;
  } catch (error) {
    console.error(`Error downloading file ${filePath}:`, error);
    throw error;
  }
}

// Main function to download a subdirectory
async function downloadSubdirectory() {
  console.log('Initiating download of subdirectory...');
  console.time('Download operation');
  
  try {
    // Extract repository information from the current URL
    const repoInfo = extractRepositoryInfo(window.location.href);
    if (!repoInfo) {
      console.error('Failed to parse repository information from URL');
      return { success: false, message: 'Could not determine repository information from URL' };
    }
    
    // Get current directory path from URL
    console.log('Repository info:', repoInfo);
    
    // Only try direct download if we're not in a subdirectory
    if (!repoInfo.subdirectory || repoInfo.subdirectory.trim() === '') {
      // First try the native GitHub download button if available
      if (tryDirectDownload(repoInfo)) {
        return { success: true, message: 'Using GitHub native download' };
      }
    } else {
      console.log(`Subdirectory detected: ${repoInfo.subdirectory}, using manual ZIP creation`);
    }
    
    // If native download isn't available or fails, proceed with manual download
    console.log('Native download not available, initiating manual download');
    
    // Attempt to load JSZip - this will provide a proper JSZip class
    console.log('Loading JSZip library using CSP-compliant method...');
    let JSZipClass;
    
    try {
      // Load JSZip first before we try to use it
      JSZipClass = await loadJSZip();
      console.log('JSZip loaded successfully via promise:', !!JSZipClass);
    } catch (jsZipError) {
      console.error('Error loading JSZip:', jsZipError);
      
      // Show user-friendly error message with retry option
      if (confirm('There was a problem loading the ZIP library due to browser security restrictions. Would you like to try an alternative method?')) {
        // Use a simple fallback method
        console.log('Using fallback minimal JSZip implementation');
        // This creates a constructor from our embedded minimal implementation
        try {
          const MinimalConstructor = new Function('return ' + JSZipMinimal + '; return JSZipMinimal;')();
          JSZipClass = MinimalConstructor;
          console.log('Using minimal JSZip fallback implementation');
        } catch (fallbackError) {
          console.error('Error creating fallback JSZip implementation:', fallbackError);
          alert('Failed to use fallback ZIP method. You may need to reload the page or check extension permissions.');
          return { success: false, message: 'Failed to load ZIP library: ' + jsZipError.message };
        }
      } else {
        return { success: false, message: 'Download cancelled' };
      }
    }
    
    // Create a new JSZip instance
    console.log('Creating new JSZip instance...');
    let zip;
    try {
      // Check if JSZipClass is a proper constructor
      if (typeof JSZipClass === 'function') {
        zip = new JSZipClass();
        console.log('Created JSZip instance from provided constructor');
      } else if (typeof JSZip === 'function') { 
        // Global JSZip might be available if script injection succeeded
        zip = new JSZip();
        console.log('Created JSZip instance from global JSZip');
      } else {
        throw new Error('No valid JSZip constructor available');
      }
    } catch (error) {
      console.error('Failed to create JSZip instance:', error);
      
      // One last attempt with a simple wrapper
      try {
        console.log('Attempting simple wrapper as last resort');
        // Create a very simple wrapper that behaves like JSZip minimally
        zip = {
          files: {},
          folder: function(name) {
            const self = this;
            return {
              file: function(filename, content) {
                const path = name ? name + '/' + filename : filename;
                self.files[path] = content;
                return this;
              },
              folder: function(subName) {
                const fullPath = name ? name + '/' + subName : subName;
                return {
                  file: function(filename, content) {
                    const path = fullPath + '/' + filename;
                    self.files[path] = content;
                    return this;
                  }
                };
              }
            };
          },
          file: function(name, content) {
            this.files[name] = content;
            return this;
          },
          generateAsync: function(options, onUpdate) {
            return new Promise((resolve) => {
              // Just make a text file with file list as fallback
              const fileList = Object.keys(this.files).map(name => ({
                name,
                size: this.files[name].byteLength || this.files[name].length || 0
              }));
              
              const metadata = {
                message: "ZIP creation failed. Individual files list provided.",
                files: fileList
              };
              
              // Show progress
              if (typeof onUpdate === 'function') {
                onUpdate({ percent: 50 });
                setTimeout(() => onUpdate({ percent: 100 }), 500);
              }
              
              // Create blob with JSON data
              const blob = new Blob([JSON.stringify(metadata, null, 2)], 
                                   { type: 'application/json' });
              resolve(blob);
            });
          }
        };
        console.log('Created simple JSZip wrapper as fallback');
      } catch (wrapperError) {
        console.error('Even simple wrapper failed:', wrapperError);
        alert('Could not create ZIP file. Please try downloading files individually or reload the page.');
        return { success: false, message: 'Failed to create ZIP file: ' + error.message };
      }
    }
    
    // Try downloading the files using GitHub API
    try {
      let currentPath = repoInfo.subdirectory || '';
      let directoryName = currentPath ? 
                         currentPath.split('/').pop() : 
                         repoInfo.repo;
      
      // Start the download process
      console.log(`Starting download for ${directoryName}`);
      sendProgressUpdate(`Starting download for ${directoryName}...`);
      
      let completedFiles = 0;
      let failedFiles = 0;
      let totalFiles = 0;
      
      // Process the directory
      const result = await processDirectory(
        repoInfo, 
        currentPath,
        zip,
        (status) => {
          if (status.totalFiles) totalFiles = status.totalFiles;
          if (status.completedFiles) completedFiles = status.completedFiles;
          if (status.failedFiles) failedFiles = status.failedFiles;
        }
      );
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to process directory');
      }
      
      // Generate ZIP and handle download
      console.log(`Download processing completed. Files processed: ${completedFiles}, failed: ${failedFiles}`);
      
      // This is the main function that will generate and download the ZIP file
      return await generateAndDownloadZip(zip, directoryName, completedFiles, failedFiles, totalFiles);
      
    } catch (error) {
      console.error('Error downloading directory:', error);
      sendProgressUpdate('Download failed: ' + error.message);
      return { success: false, message: error.message };
    }
  } catch (error) {
    console.error('Error in downloadSubdirectory:', error);
    console.timeEnd('Download operation');
    return { success: false, message: error.message };
  } finally {
    console.timeEnd('Download operation');
  }
}

// Process a directory and its contents recursively
async function processDirectory(repoInfo, path, zip, progressCallback) {
  try {
    sendProgressUpdate(`Processing directory: ${path || 'root'}`);
    console.log(`Processing directory: ${path || 'root'}`);
    
    // Fetch directory contents from GitHub API
    const apiUrl = getApiUrl(repoInfo, path);
    console.log(`Fetching directory contents from API: ${apiUrl}`);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API request failed: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`GitHub API request failed (${response.status}): ${response.statusText}`);
    }
    
    const items = await response.json();
    console.log(`API returned ${items.length} items for ${path || 'root'}`);
    
    // Update total count
    progressCallback({ totalFiles: items.length });
    
    // Process each item in the directory
    let completedFiles = 0;
    let failedFiles = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemPath = path ? `${path}/${item.name}` : item.name;
      
      console.log(`Processing ${item.type}: ${itemPath} (${i+1}/${items.length})`);
      sendProgressUpdate(`Processing ${item.type}: ${item.name} (${i+1}/${items.length})`);
      
      if (item.type === 'file') {
        try {
          // Download the file
          sendProgressUpdate(`Downloading: ${item.name} (${i+1} of ${items.length})`);
          
          const fileData = await downloadFile(repoInfo, itemPath);
          if (!fileData) {
            throw new Error(`Failed to download ${itemPath}`);
          }
          
          // Calculate the relative path to use in the ZIP
          // If we're downloading a subdirectory, we need to remove the subdirectory path prefix
          // so we don't get nested subdirectory folders
          let relativePath = itemPath;
          
          if (repoInfo.subdirectory) {
            // If we have a subdirectory specified, use just the directory name as the root folder
            const baseDir = repoInfo.subdirectory.split('/').pop();
            
            // Check if the current path starts with the subdirectory path
            if (itemPath.startsWith(repoInfo.subdirectory)) {
              // Replace the subdirectory path with just the directory name
              relativePath = baseDir + itemPath.substring(repoInfo.subdirectory.length);
            }
          }
          
          console.log(`Adding file to ZIP: ${relativePath}`);
          
          // Add file to the zip
          zip.file(relativePath, fileData);
          console.log(`Added ${itemPath} to ZIP, size: ${fileData.byteLength} bytes`);
          
          completedFiles++;
          progressCallback({ completedFiles });
        } catch (error) {
          console.error(`Error processing file ${itemPath}:`, error);
          failedFiles++;
          progressCallback({ failedFiles });
        }
      } else if (item.type === 'dir') {
        console.log(`Processing directory: ${itemPath}`);
        
        // Process the subdirectory
        try {
          const subDirResult = await processDirectory(repoInfo, itemPath, zip, (subProgress) => {
            // Update counts from subdirectory
            if (subProgress.completedFiles) {
              completedFiles += subProgress.completedFiles;
              progressCallback({ completedFiles });
            }
            if (subProgress.failedFiles) {
              failedFiles += subProgress.failedFiles;
              progressCallback({ failedFiles });
            }
            if (subProgress.totalFiles) {
              progressCallback({ 
                totalFiles: (progressCallback.totalFiles || 0) + subProgress.totalFiles
              });
            }
          });
          
          if (!subDirResult.success) {
            console.warn(`Warning processing subdirectory ${itemPath}: ${subDirResult.message}`);
          }
        } catch (subDirError) {
          console.error(`Error processing subdirectory ${itemPath}:`, subDirError);
          failedFiles++;
          progressCallback({ failedFiles });
        }
      }
    }
    
    return { 
      success: true, 
      completedFiles, 
      failedFiles,
      totalFiles: items.length
    };
  } catch (error) {
    console.error(`Error processing directory ${path}:`, error);
    return { success: false, message: error.message };
  }
}

// Function to safely download a blob with proper error handling
async function downloadBlobSafely(blob, filename) {
  return new Promise((resolve, reject) => {
    try {
      // Create blob URL
      const blobUrl = URL.createObjectURL(blob);
      console.log(`Created blob URL for download: ${blobUrl}`);
      
      // Try using chrome.downloads API through the background script first
      chrome.runtime.sendMessage({
        action: "downloadBlob",
        url: blobUrl,
        filename: filename
      }).then(response => {
        if (response && response.success) {
          console.log("Download initiated through downloads API");
          
          // Set a delay before revoking the URL to ensure Chrome has accessed it
          setTimeout(() => {
            try {
              URL.revokeObjectURL(blobUrl);
              console.log(`Revoked blob URL: ${blobUrl}`);
            } catch (revokeError) {
              console.warn(`Error revoking blob URL: ${revokeError.message}`);
            }
            resolve(true);
          }, 30000); // Give Chrome 30 seconds to access the URL
        } else {
          // Fall back to <a> tag download method
          console.log("Downloads API failed, falling back to link method");
          fallbackToLinkMethod();
        }
      }).catch(error => {
        console.error("Error with downloads API:", error);
        fallbackToLinkMethod();
      });
      
      // Fallback download method using <a> tag
      function fallbackToLinkMethod() {
        // Create download link
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        
        // Add to document and click
        document.body.appendChild(a);
        
        // Track download attempt
        let downloadAttempted = false;
        
        a.addEventListener('click', () => {
          downloadAttempted = true;
          console.log(`Download initiated for ${filename}`);
          
          // Remove the link after a delay
          setTimeout(() => {
            if (document.body.contains(a)) {
              document.body.removeChild(a);
            }
            
            // Keep the URL alive longer to prevent "File wasn't available" error
            setTimeout(() => {
              try {
                URL.revokeObjectURL(blobUrl);
                console.log(`Revoked blob URL: ${blobUrl}`);
              } catch (revokeError) {
                console.warn(`Error revoking blob URL: ${revokeError.message}`);
              }
              resolve(true);
            }, 30000); // Wait 30 seconds before revoking
          }, 1000);
        });
        
        // Click the link
        a.click();
        
        // Check if download was attempted
        setTimeout(() => {
          if (!downloadAttempted) {
            console.warn(`Download may not have started for ${filename}`);
            
            // Try in a new window as a last resort
            try {
              const newWindow = window.open(blobUrl, '_blank');
              if (newWindow) {
                console.log("Opened download in new window");
                setTimeout(() => newWindow.close(), 5000);
              } else {
                console.warn("Popup was blocked");
              }
            } catch (windowError) {
              console.error("New window method failed:", windowError);
            }
            
            // We've tried everything
            resolve(false);
          }
        }, 2000);
      }
    } catch (error) {
      console.error("Download error:", error);
      reject(error);
    }
  });
}

// Generate the zip file and handle downloading
async function generateAndDownloadZip(zip, directoryName, completedFiles, failedFiles, totalFiles) {
  try {
    sendProgressUpdate(`Creating ZIP file with ${completedFiles} files...`);
    console.log("Generating ZIP with options...");
    
    // Debug: log the structure of files in ZIP 
    console.log("Files in ZIP before generation:");
    if (zip.files) {
      Object.keys(zip.files).forEach(file => {
        console.log(` - ${file}`);
      });
    }
    
    // Check if we're using the simplified wrapper by checking for a key function
    const isRealJSZip = zip && typeof zip.generateAsync === 'function' && 
                        !zip.constructor.toString().includes('SimpleJSZip');
    
    console.log("ZIP implementation check:", {
      hasZip: !!zip,
      isRealJSZip: isRealJSZip,
      hasGenerateAsync: zip && typeof zip.generateAsync === 'function',
      zipType: zip && zip.constructor ? zip.constructor.name : 'Unknown'
    });
    
    if (!isRealJSZip) {
      console.warn("Not using real JSZip - attempting to load JSZip again");
      
      // Try to load JSZip one more time
      try {
        const JSZipClass = await loadJSZip();
        
        if (JSZipClass) {
          console.log("Successfully loaded JSZip from window global");
          
          // Create a new proper JSZip instance
          const newZip = new JSZipClass();
          
          // Copy files from old zip to new zip if possible
          if (zip && zip.files) {
            console.log("Copying files from old zip to new zip");
            
            for (const [path, fileData] of Object.entries(zip.files)) {
              try {
                if (fileData && (fileData.async || fileData._data)) {
                  // If it's a valid JSZip file object with data
                  console.log(`Adding ${path} to new ZIP`);
                  let fileContent = fileData._data || fileData.async();
                  
                  // If it's a function, call it
                  if (typeof fileContent === 'function') {
                    fileContent = await fileContent();
                  }
                  
                  newZip.file(path, fileContent);
                }
              } catch (fileError) {
                console.error(`Error copying file ${path}:`, fileError);
              }
            }
          }
          
          // Replace old zip with the new one
          zip = newZip;
        } else {
          throw new Error("JSZip not available after loading");
        }
      } catch (error) {
        console.error("Failed to load real JSZip:", error);
        // Continue with the original zip as fallback
      }
    }
    
    // Generate zip with options that optimize for browser compatibility
    const zipOptions = {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 5  // Mid-level compression (1-9, where 9 is highest)
      }
    };
    
    // Add logging to check what's in the zip before generating
    console.log("Files in ZIP before generation:", zip.files ? Object.keys(zip.files).length : "unknown");
    
    // Generate ZIP and track progress
    const zipBlob = await zip.generateAsync(zipOptions, metadata => {
      if (metadata.percent % 10 === 0) {
        sendProgressUpdate(`Creating ZIP file: ${Math.round(metadata.percent)}% complete...`);
      }
    });

    console.log("ZIP generated successfully, size:", zipBlob.size, "bytes");
    const fileSizeMB = (zipBlob.size / (1024 * 1024)).toFixed(2);
    
    // If zip is suspiciously small, warn user
    if (zipBlob.size < 1000 && completedFiles > 0) {
      console.warn("Generated ZIP is suspiciously small!", { size: zipBlob.size, fileCount: completedFiles });
      
      // Try one last time to create a direct download for each file
      if (confirm("The generated ZIP file appears to be corrupt or incomplete. Would you like to download files individually instead?")) {
        const repoInfo = extractRepositoryInfo(window.location.href);
        if (repoInfo) {
          await downloadFilesIndividually(repoInfo, repoInfo.subdirectory || "");
          return { success: true, method: "individual_files" };
        }
      }
    }
    
    // Now initiate the download using the blob URL method
    sendProgressUpdate(`Downloading ${directoryName}.zip (${fileSizeMB} MB)...`);
    
    try {
      // Create a blob URL for direct download
      const blobUrl = URL.createObjectURL(zipBlob);
      console.log("Created blob URL for download:", blobUrl);
      
      // Create a download link for direct downloading
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = `${directoryName}.zip`;
      downloadLink.style.display = 'none';
      downloadLink.target = '_blank'; // Try to force download in a new tab
      
      // Add to document and click
      document.body.appendChild(downloadLink);
      downloadLink.click();
      
      // Remove the link after a short delay
      setTimeout(() => {
        if (document.body.contains(downloadLink)) {
          document.body.removeChild(downloadLink);
        }
        
        // Keep blob URL valid for a longer time to avoid "file not found" errors
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          console.log("Revoked blob URL");
        }, 60000); // 60 seconds
      }, 1000);
      
      sendProgressUpdate(`Download complete! ${completedFiles} files included in ZIP.`);
      
      // Send success message
      chrome.runtime.sendMessage({
        action: "downloadComplete",
        message: `Download started! ${completedFiles} files processed.`
      }).catch(e => console.warn("Message sending error:", e));
      
      return {
        success: true,
        method: "direct_download",
        totalFiles,
        filesDownloaded: completedFiles,
        filesFailed: failedFiles
      };
    } catch (directDownloadError) {
      console.error("Direct download failed:", directDownloadError);
      
      // Fallback: try to download the blob using FileSaver.js
      try {
        console.log("Trying FileSaver.js for download");
        if (typeof saveAs === 'function') {
          saveAs(zipBlob, `${directoryName}.zip`);
          sendProgressUpdate(`Download initiated! ${completedFiles} files included.`);
          return {
            success: true,
            method: "filesaver",
            filesDownloaded: completedFiles,
            filesFailed: failedFiles
          };
        }
      } catch (fileSaverError) {
        console.error("FileSaver download failed:", fileSaverError);
      }
      
      // Last resort: Store blob in the background page and use Chrome's download API
      console.log("Falling back to Chrome download API");
      
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "storeBlob",
            blob: zipBlob,
            filename: `${directoryName}.zip`
          }, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || "Failed to store blob"));
            }
          });
        });
        
        if (!response || !response.blobId) {
          throw new Error("Failed to store blob for download");
        }
        
        // Use Chrome's downloads API
        const downloadResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "downloadDirectly",
            blobId: response.blobId,
            filename: `${directoryName}.zip`
          }, response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || "Download failed"));
            }
          });
        });
        
        sendProgressUpdate(`Download initiated via Chrome API! ${completedFiles} files included.`);
        
        return {
          success: true,
          method: "chrome_api",
          totalFiles,
          filesDownloaded: completedFiles,
          filesFailed: failedFiles
        };
      } catch (apiError) {
        console.error("Chrome downloads API failed:", apiError);
        
        // Final fallback: open the download page
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "storeBlob",
              blob: zipBlob,
              filename: `${directoryName}.zip`
            }, response => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else if (response && response.success) {
                resolve(response);
              } else {
                reject(new Error(response?.error || "Failed to store blob"));
              }
            });
          });
          
          if (!response || !response.blobId) {
            throw new Error("Failed to store blob for download");
          }
          
          // Open the download page
          chrome.runtime.sendMessage({
            action: "openDownloadPage",
            blobId: response.blobId,
            filename: `${directoryName}.zip`,
            fileSize: zipBlob.size,
            autoStart: true
          }, (response) => {
            if (response && response.success) {
              console.log("Download page opened successfully");
            } else {
              console.error("Failed to open download page:", response?.error);
            }
          });
          
          sendProgressUpdate(`Download page opened. Follow instructions there to complete the download.`);
          
          return {
            success: true,
            method: "download_page",
            totalFiles,
            filesDownloaded: completedFiles,
            filesFailed: failedFiles
          };
        } catch (pageError) {
          console.error("Error opening download page:", pageError);
          throw new Error("All download methods failed");
        }
      }
    }
  } catch (error) {
    console.error("Error in ZIP generation or download:", error);
    
    // Send error message
    chrome.runtime.sendMessage({
      action: "downloadError",
      message: error.message || "Failed to download the ZIP file"
    }).catch(e => console.warn("Failed to send error message:", e));
    
    throw error;
  }
}

// Downloads files individually as a fallback method
async function downloadFilesIndividually(repoInfo, path) {
  try {
    sendProgressUpdate("Preparing individual file download...");
    
    // Get directory contents using the API
    const apiUrl = getApiUrl(repoInfo, path);
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status})`);
    }
    
    const items = await response.json();
    console.log(`Found ${items.length} items to download individually`);
    
    // Process each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (item.type === 'file') {
        sendProgressUpdate(`Downloading file ${i+1}/${items.length}: ${item.name}`);
        
        // Create a link for direct download
        const link = document.createElement('a');
        link.href = item.download_url;
        link.download = item.name;
        link.target = '_blank';
        link.style.display = 'none';
        
        // Add to document and click
        document.body.appendChild(link);
        link.click();
        
        // Remove after a short delay
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
        }, 500);
        
        // Add a small delay between downloads to avoid blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      } else if (item.type === 'dir') {
        // Offer to open directory for manual download
        if (confirm(`Do you want to open the '${item.name}' directory to download its contents?`)) {
          window.open(item.html_url, '_blank');
        }
      }
    }
    
    sendProgressUpdate(`Completed individual downloads for ${items.length} items`);
    return { success: true, message: 'Individual downloads initiated' };
  } catch (error) {
    console.error("Error downloading files individually:", error);
    return { success: false, message: error.message };
  }
}

// Function to observe DOM changes and add the download button when navigation happens
function setupMutationObserver() {
  // Add download button on initial page load
  addDownloadButtonToUI();

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
