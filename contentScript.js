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

// Function to load JSZip library in a CSP-compliant way
async function loadJSZip() {
  if (jsZip) {
    return jsZip;
  }

  console.log("Loading JSZip library...");
  
  try {
    // Approach 1: Use chrome.runtime.getURL to get the local file URL
    const jsZipUrl = chrome.runtime.getURL("jszip.min.js");
    console.log("Loading JSZip from:", jsZipUrl);
    
    // Import the file directly, avoiding inline script execution
    try {
      // Using fetch and importScripts or dynamic import would also get blocked by CSP
      // Instead we need to make a request to the background script
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: "loadJSZip"
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error loading JSZip:", chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else if (response && response.success) {
            console.log("JSZip loaded from background service worker");
            // Create a constructor from the received code
            try {
              // We'll use the global JSZip function if it's available
              if (window.JSZip) {
                jsZip = window.JSZip;
                resolve(jsZip);
              } else {
                // Try to use a simple wrapper class as fallback
                jsZip = createJSZipWrapper();
                resolve(jsZip);
              }
            } catch (err) {
              console.error("Error creating JSZip constructor:", err);
              reject(err);
            }
          } else {
            reject(new Error("Failed to load JSZip from background service worker"));
          }
        });
      });
    } catch (importError) {
      console.error("Error importing JSZip:", importError);
      throw importError;
    }
  } catch (error) {
    console.error("All methods to load JSZip failed:", error);
    throw error;
  }
}

// Create a simplified JSZip wrapper when the real one fails to load
function createJSZipWrapper() {
  return class SimpleJSZip {
    constructor() {
      this.files = {};
      this.folders = {};
    }
    
    folder(name) {
      if (!this.folders[name]) {
        this.folders[name] = {
          files: {},
          folders: {},
          
          file: function(filename, content) {
            this.files[filename] = content;
            return this;
          },
          
          folder: function(subname) {
            const path = name + '/' + subname;
            if (!this.folders[subname]) {
              this.folders[subname] = {
                files: {},
                folders: {},
                file: function(f, c) { this.files[f] = c; return this; },
                folder: function() { return this; }
              };
            }
            return this.folders[subname];
          }
        };
      }
      return this.folders[name];
    }
    
    file(name, content) {
      this.files[name] = content;
      return this;
    }
    
    async generateAsync() {
      // Since we can't create a real ZIP, just create a text file with file listing
      console.log("Using simplified ZIP generation");
      
      const fileList = [];
      // Process root files
      Object.keys(this.files).forEach(filename => {
        fileList.push({ path: filename });
      });
      
      // We would process folders but this is a simplified implementation
      // In this fallback, suggest individual downloads instead of ZIP
      
      const content = JSON.stringify({
        message: "Unable to create ZIP file due to extension restrictions. Please download files individually.",
        files: fileList
      }, null, 2);
      
      return new Blob([content], { type: 'application/json' });
    }
  };
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
  
  // Create the download button
  const downloadButton = document.createElement('li');
  downloadButton.className = 'UnderlineNav-item d-flex';
  downloadButton.id = 'github-repo-downloader-btn';
  downloadButton.style.marginLeft = '8px';
  
  const isTreeView = window.location.pathname.includes('/tree/');
  const buttonText = isTreeView ? 'Download Directory' : 'Download Repository';
  
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
    
    // Add green styling
    const navLink = downloadButton.querySelector('a');
    navLink.style.color = '#2ea44f';
    navLink.style.fontWeight = '600';
    
    // Add hover effect
    navLink.addEventListener('mouseover', () => {
      navLink.style.backgroundColor = 'rgba(46, 164, 79, 0.1)';
    });
    navLink.addEventListener('mouseout', () => {
      navLink.style.backgroundColor = '';
    });
    
    navBar.appendChild(downloadButton);
  } 
  // Legacy GitHub UI
  else {
    // Create button for older GitHub UI
    downloadButton.innerHTML = `
      <a class="btn btn-sm btn-primary" style="background-color: #2ea44f; border-color: #2ea44f;">
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-download mr-1">
          <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
        </svg>
        ${buttonText}
      </a>
    `;
    
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
  
  console.log("Download button added to GitHub UI");
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

// Function to try direct download methods
async function tryDirectDownload(repoInfo, subdirectoryPath) {
  try {
    console.log("Attempting direct download...");
    
    // Method 1: Look for GitHub's download button and click it
    const downloadBtn = document.querySelector('a[data-testid="download-raw-button"], a[data-turbo-frame="archive-fragment"]');
    if (downloadBtn) {
      console.log("Found GitHub's download button, clicking it");
      downloadBtn.click();
      return true;
    }
    
    // Method 2: For repository root, construct and use standard GitHub download URL
    if (!subdirectoryPath || subdirectoryPath === '') {
      const downloadUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
      console.log(`Using repository root download URL: ${downloadUrl}`);
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${repoInfo.repo}.zip`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
      }, 1000);
      
      return true;
    }
    
    console.log("No direct download method available for this directory");
    return false;
  } catch (error) {
    console.error("Direct download failed:", error);
    return false;
  }
}

// Function to download the current subdirectory
async function downloadSubdirectory() {
  // Show the popup
  chrome.runtime.sendMessage({ action: "showPopup" });
  
  // Set up variables for tracking progress
  let addedFilesCount = 0;
  let failedFilesCount = 0;
  let processedDirsCount = 0;
  let totalDirsToProcess = 1; // Start with 1 for the root directory
  
  try {
    console.log("Starting download process...");
    
    // Extract repository information
    const repoInfo = extractRepositoryInfo(window.location.href);
    if (!repoInfo) {
      throw new Error("Could not extract repository information from URL");
    }
    
    console.log("Repository info:", repoInfo);
    sendProgressUpdate("Initializing download...");
    
    // Determine the subdirectory path within the repository
    let subdirectoryPath = "";
    if (repoInfo.subdirectory) {
      subdirectoryPath = repoInfo.subdirectory;
    }
    
    // Initialize JSZip
    sendProgressUpdate("Initializing ZIP file...");
    
    // If JSZip wasn't pre-loaded, try to load it now
    if (!jsZip && !jsZipLoaded) {
      try {
        console.log("JSZip wasn't pre-loaded, attempting to load now");
        await loadJSZip();
        jsZipLoaded = true;
      } catch (zipLoadError) {
        console.error("Failed to load JSZip:", zipLoadError);
        
        // Show an error message with option to continue
        if (confirm("JSZip couldn't be loaded. Would you like to download files individually instead?")) {
          // Call a function to handle individual file downloads as fallback
          await downloadFilesIndividually(repoInfo, subdirectoryPath);
          return;
        } else {
          throw new Error("Download canceled: JSZip couldn't be loaded");
        }
      }
    }
    
    // Create a new ZIP instance
    let zip;
    try {
      console.log("Creating JSZip instance");
      zip = new JSZip();
    } catch (error) {
      console.error("Error creating JSZip instance:", error);
      
      // Try one more time to load JSZip
      try {
        await loadJSZip();
        zip = new JSZip();
      } catch (retryError) {
        console.error("Failed to create JSZip instance after retry:", retryError);
        
        // Show an error message with option to continue
        if (confirm("JSZip couldn't be initialized. Would you like to download files individually instead?")) {
          // Call a function to handle individual file downloads as fallback
          await downloadFilesIndividually(repoInfo, subdirectoryPath);
          return;
        } else {
          throw new Error("Download canceled: Could not initialize JSZip");
        }
      }
    }
    
    let directoryName = subdirectoryPath ? subdirectoryPath.split('/').pop() : repoInfo.repo;
    
    // Check if we need to directly download a ZIP file
    if (await shouldUseDirectDownload(repoInfo, subdirectoryPath)) {
      if (await tryDirectDownload(repoInfo, subdirectoryPath)) {
        sendProgressUpdate("Direct ZIP download initiated!");
        
        // Send success message
        chrome.runtime.sendMessage({
          action: "downloadComplete",
          message: "Using GitHub's ZIP download feature",
        });
        
        return;
      }
    }
    
    // Process the subdirectory recursively
    sendProgressUpdate(`Processing ${subdirectoryPath || "repository root"}...`);
    
    const rootFolder = zip.folder(directoryName);
    if (!rootFolder) {
      throw new Error("Failed to create folder in ZIP file");
    }
    
    // Set up tracking variables for files
    let totalFiles = 0;
    let completedFiles = 0;
    let failedFiles = 0;
    
    // Get the content type from a URL
    function getContentTypeFromUrl(url) {
      if (url.includes('/tree/')) {
        return 'dir';
      } else if (url.includes('/blob/')) {
        return 'file';
      }
      return 'unknown';
    }
    
    // Convert a GitHub file URL to a raw content URL
    function convertToRawUrl(url) {
      return url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }
    
    // Get a correct API URL for a directory listing
    function getDirectoryApiUrl(path, repoInfo) {
      return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${path}?ref=${repoInfo.branch}`;
    }
    
    // Download and add file to ZIP
    async function downloadAndAddFile(fileItem, zipFolder) {
      try {
        console.log(`Downloading file: ${fileItem.path}, URL: ${fileItem.download_url}`);
        
        // Try to download the file
        let response = await fetch(fileItem.download_url, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Accept': '*/*'
          }
        });
        
        // If direct download fails, try alternative methods
        if (!response.ok) {
          console.log(`First download attempt failed (${response.status}), trying alternative methods`);
          
          // Try GitHub raw URL if we have a blob URL
          if (fileItem.html_url || fileItem.url) {
            const urlToConvert = fileItem.html_url || fileItem.url;
            const rawUrl = convertToRawUrl(urlToConvert);
            console.log(`Trying raw URL: ${rawUrl}`);
            
            response = await fetch(rawUrl, {
              method: 'GET',
              cache: 'no-store'
            });
          }
          
          // If that still fails, try GitHub's raw domain
          if (!response.ok) {
            // Extract path components from the current item path
            const pathParts = fileItem.path.split('/');
            const fileName = pathParts.pop();
            const dirPath = pathParts.join('/');
            
            const alternateUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/${fileItem.path}`;
            console.log(`Trying alternate raw URL: ${alternateUrl}`);
            
            response = await fetch(alternateUrl, {
              method: 'GET',
              cache: 'no-store'
            });
            
            if (!response.ok) {
              throw new Error(`Failed to download ${fileItem.name}: Status ${response.status}`);
            }
          }
        }
        
        // Get the file content
        const content = await response.arrayBuffer();
        console.log(`Downloaded ${fileItem.name}, size: ${content.byteLength} bytes`);
        
        // Add file to the zip folder
        zipFolder.file(fileItem.name, content);
        return true;
      } catch (error) {
        console.error(`Error downloading ${fileItem.name}:`, error);
        return false;
      }
    }
    
    // Main recursive directory processing function
    async function processDirectoryRecursively(dirPath, zipFolder) {
      console.log(`Processing directory: ${dirPath}`);
      
      sendProgressUpdate(`Processing directory: ${dirPath || 'root'}`);
      
      try {
        // Use GitHub API to get directory contents
        const apiUrl = getDirectoryApiUrl(dirPath, repoInfo);
        console.log(`Fetching directory contents from API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        
        if (!response.ok) {
          console.error(`API error: ${response.status} ${response.statusText}`);
          
          // If API fails, fall back to HTML scraping from current page
          if (!dirPath || dirPath === subdirectoryPath) {
            console.log("Falling back to HTML scraping for current page");
            return await processCurrentPageDirectory(dirPath, zipFolder);
          } else {
            // For subdirectories, fetch their pages for scraping
            return await processDirectoryFromUrl(
              `https://github.com/${repoInfo.owner}/${repoInfo.repo}/tree/${repoInfo.branch}/${dirPath}`,
              dirPath, 
              zipFolder
            );
          }
        }
        
        const contents = await response.json();
        console.log(`API returned ${contents.length} items for ${dirPath || 'root directory'}`);
        
        // Process each item
        for (let i = 0; i < contents.length; i++) {
          const item = contents[i];
          console.log(`Processing ${item.type}: ${item.path} (${i+1}/${contents.length})`);
          
          if (item.type === 'dir') {
            // Create a folder for the directory
            const folderName = item.name;
            const subFolder = zipFolder.folder(folderName);
            if (!subFolder) {
              console.error(`Failed to create subfolder ${folderName}`);
              continue;
            }
            
            // Process subdirectory recursively
            const subDirPath = dirPath ? `${dirPath}/${folderName}` : folderName;
            totalDirsToProcess++;
            await processDirectoryRecursively(subDirPath, subFolder);
            processedDirsCount++;
          } else if (item.type === 'file') {
            // Download and add file to ZIP
            totalFiles++;
            
            sendProgressUpdate(`Downloading: ${item.name} (${completedFiles + 1} of ${totalFiles})`);
            
            try {
              const success = await downloadAndAddFile(item, zipFolder);
              if (success) {
                completedFiles++;
                addedFilesCount++;
              } else {
                failedFiles++;
                failedFilesCount++;
              }
            } catch (error) {
              console.error(`Error downloading file ${item.name}:`, error);
              failedFiles++;
              failedFilesCount++;
            }
          }
        }
        
        return contents.length;
      } catch (error) {
        console.error(`Error processing directory ${dirPath}:`, error);
        // Fall back to HTML scraping if API fails
        if (!dirPath || dirPath === subdirectoryPath) {
          return await processCurrentPageDirectory(dirPath, zipFolder);
        } else {
          return await processDirectoryFromUrl(
            `https://github.com/${repoInfo.owner}/${repoInfo.repo}/tree/${repoInfo.branch}/${dirPath}`,
            dirPath,
            zipFolder
          );
        }
      }
    }
    
    // Function to process the current page's directory
    async function processCurrentPageDirectory(dirPath, zipFolder) {
      console.log(`Processing current page directory: ${dirPath}`);
      
      // Find all files and directories in the current page
      const entries = findFilesAndDirectoriesInCurrentPage();
      console.log(`Found ${entries.length} entries in current page:`, entries);
      
      if (entries.length === 0) {
        console.warn("No entries found in current page, this might be a GitHub UI change");
        return 0;
      }
      
      // Process each entry
      let processedCount = 0;
      for (const entry of entries) {
        
        if (entry.isDirectory) {
          // Create subfolder
          const folderName = entry.name;
          const subFolder = zipFolder.folder(folderName);
          if (!subFolder) {
            console.error(`Failed to create subfolder ${folderName}`);
            continue;
          }
          
          // Get subdirectory path
          const subDirPath = dirPath ? `${dirPath}/${folderName}` : folderName;
          console.log(`Processing subdirectory: ${subDirPath}, URL: ${entry.url}`);
          
          // Process subdirectory
          try {
            totalDirsToProcess++;
            await processDirectoryFromUrl(entry.url, subDirPath, subFolder);
            processedDirsCount++;
            processedCount++;
          } catch (error) {
            console.error(`Error processing subdirectory ${subDirPath}:`, error);
          }
        } else {
          // Add file to ZIP
          totalFiles++;
          processedCount++;
          
          sendProgressUpdate(`Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`);
          
          try {
            const fileItem = {
              name: entry.name,
              path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
              download_url: entry.rawUrl
            };
            
            const success = await downloadAndAddFile(fileItem, zipFolder);
            if (success) {
              completedFiles++;
              addedFilesCount++;
            } else {
              failedFiles++;
              failedFilesCount++;
            }
          } catch (error) {
            console.error(`Error downloading file ${entry.name}:`, error);
            failedFiles++;
            failedFilesCount++;
          }
        }
      }
      
      return processedCount;
    }
    
    // Start the recursive directory processing
    try {
      console.log("Starting directory processing");
      await processDirectoryRecursively(subdirectoryPath, rootFolder);
    } catch (processingError) {
      console.error("Error during directory processing:", processingError);
      
      // If we have some files, try to continue with what we have
      if (totalFiles === 0) {
        throw new Error("No files found to download. Please check console for details.");
      }
    }
    
    // Check if we found and processed any files
    if (totalFiles === 0) {
      throw new Error("No files found to download. Please check console for details.");
    }
    
    // Generate and download the ZIP file
    return await generateAndDownloadZip(zip, directoryName, completedFiles, failedFiles, totalFiles);
    
  } catch (error) {
    console.error("Download error:", error);
    
    // Send error message
    try {
      chrome.runtime.sendMessage({
        action: "downloadError",
        message: error.message || "An unknown error occurred"
      }).catch(e => console.warn("Failed to send error message:", e));
    } catch (msgError) {
      console.error("Failed to send error message:", msgError);
    }
    
    throw error;
  }
}

// Function to process a directory from its URL
async function processDirectoryFromUrl(url, dirPath, zipFolder) {
  console.log(`Fetching directory page: ${url}`);
  
  try {
    // Fetch the directory page
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch directory page: ${response.status}`);
    }
    
    const html = await response.text();
    console.log(`Fetched HTML page for ${dirPath}, size: ${html.length} bytes`);
    
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Find all files and directories in the fetched HTML
    const entries = findFilesAndDirectoriesInHTML(doc, url);
    console.log(`Found ${entries.length} entries in directory ${dirPath} HTML:`, entries);
    
    if (entries.length === 0) {
      console.warn(`No entries found in ${dirPath}, this might be a GitHub UI change`);
      return 0;
    }
    
    // Process each entry
    let processedCount = 0;
    for (const entry of entries) {
      processedItems++;
      
      if (entry.isDirectory) {
        // Create subfolder
        const folderName = entry.name;
        const subFolder = zipFolder.folder(folderName);
        if (!subFolder) {
          console.error(`Failed to create subfolder ${folderName}`);
          continue;
        }
        
        // Get subdirectory path and process it
        const subDirPath = `${dirPath}/${folderName}`;
        try {
          await processDirectoryFromUrl(entry.url, subDirPath, subFolder);
          processedCount++;
        } catch (error) {
          console.error(`Error processing subdirectory ${subDirPath}:`, error);
        }
      } else {
        // Add file to ZIP
        totalFiles++;
        processedCount++;
        
        sendProgressUpdate(`Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`);
        
        try {
          const fileItem = {
            name: entry.name,
            path: `${dirPath}/${entry.name}`,
            download_url: entry.rawUrl
          };
          
          const success = await downloadAndAddFile(fileItem, zipFolder);
          if (success) {
            completedFiles++;
          } else {
            failedFiles++;
          }
        } catch (error) {
          console.error(`Error downloading file ${entry.name}:`, error);
          failedFiles++;
        }
      }
    }
    
    return processedCount;
  } catch (error) {
    console.error(`Error fetching directory ${dirPath}:`, error);
    return 0;
  }
}

// Function to find files and directories in the current page
function findFilesAndDirectoriesInCurrentPage() {
  return findFilesAndDirectoriesInHTML(document, window.location.href);
}

// Function to find files and directories in HTML content
function findFilesAndDirectoriesInHTML(doc, baseUrl) {
  const entries = [];
  const seenUrls = new Set(); // To avoid duplicates
  
  // Try different selectors to find files and directories
  
  // Method 1: Modern GitHub UI - div rows
  const rowElements = doc.querySelectorAll('div[role="row"]');
  console.log(`Found ${rowElements.length} row elements with role=row`);
  
  for (const row of rowElements) {
    // Skip parent directory and header rows
    if (row.querySelector('[aria-label="parent directory"]') || 
        row.getAttribute('aria-labelledby') === 'files') {
      continue;
    }
    
    const nameEl = row.querySelector('a[role="rowheader"] span');
    if (nameEl) {
      const name = nameEl.textContent.trim();
      const linkEl = row.querySelector('a[role="rowheader"]');
      if (linkEl && name) {
        const url = new URL(linkEl.href, baseUrl).href;
        
        // Skip if we've already processed this URL
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        
        const svgIcon = row.querySelector('svg[aria-label="Directory"], svg[aria-label="File"]');
        const isDirectory = svgIcon && svgIcon.getAttribute('aria-label') === 'Directory';
        
        const rawUrl = isDirectory ? url : convertToRawUrl(url);
        
        entries.push({
          name,
          isDirectory,
          url,
          rawUrl
        });
        
        console.log(`Found entry (modern UI): ${name}, isDirectory: ${isDirectory}, URL: ${url}`);
      }
    }
  }
  
  // Method 2: Classic GitHub UI - js-navigation-item
  if (entries.length === 0) {
    const navItems = doc.querySelectorAll('.js-navigation-item');
    console.log(`Found ${navItems.length} navigation items`);
    
    for (const item of navItems) {
      // Skip parent directory
      if (item.classList.contains('up-tree')) continue;
      
      const linkEl = item.querySelector('.js-navigation-open, [data-testid="tree-entry-link"]');
      if (linkEl) {
        const name = linkEl.textContent.trim();
        if (name) {
          const url = new URL(linkEl.href, baseUrl).href;
          
          // Skip if we've already processed this URL
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          
          const isDirectory = getContentTypeFromUrl(url) === 'dir';
          const rawUrl = isDirectory ? url : convertToRawUrl(url);
          
          entries.push({
            name,
            isDirectory,
            url,
            rawUrl
          });
          
          console.log(`Found entry (classic UI): ${name}, isDirectory: ${isDirectory}, URL: ${url}`);
        }
      }
    }
  }
  
  // Method 3: Raw links approach - for any GitHub version
  if (entries.length === 0) {
    const allLinks = doc.querySelectorAll('a[href*="/blob/"], a[href*="/tree/"]');
    console.log(`Found ${allLinks.length} blob/tree links`);
    
    for (const link of allLinks) {
      const name = link.textContent.trim();
      const url = new URL(link.href, baseUrl).href;
      
      // Skip non-file links, GitHub UI buttons, etc.
      if (!name || 
          name.includes('Go to') || 
          url.includes('/commit/') || 
          url.includes('/find/') ||
          url.includes('/search') ||
          seenUrls.has(url)) {
        continue;
      }
      
      seenUrls.add(url);
      const isDirectory = getContentTypeFromUrl(url) === 'dir';
      const rawUrl = isDirectory ? url : convertToRawUrl(url);
      
      entries.push({
        name,
        isDirectory,
        url,
        rawUrl
      });
      
      console.log(`Found entry (link approach): ${name}, isDirectory: ${isDirectory}, URL: ${url}`);
    }
  }
  
  return entries;
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
    
    // Generate zip with options that optimize for browser compatibility
    const zipOptions = {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: {
        level: 5  // Mid-level compression (1-9, where 9 is highest)
      }
    };
    
    // Generate ZIP and track progress
    const zipBlob = await zip.generateAsync(zipOptions, metadata => {
      if (metadata.percent % 10 === 0) {
        sendProgressUpdate(`Creating ZIP file: ${Math.round(metadata.percent)}% complete...`);
      }
    });

    console.log("ZIP generated successfully, size:", zipBlob.size, "bytes");
    const fileSizeMB = (zipBlob.size / (1024 * 1024)).toFixed(2);
    
    // Now initiate the download using multiple methods for reliability
    sendProgressUpdate(`Downloading ${directoryName}.zip (${fileSizeMB} MB)...`);
    
    // Store the blob in background service worker for download
    try {
      console.log("Storing blob in background service worker...");
      
      const storeResponse = await new Promise((resolve, reject) => {
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
      
      if (!storeResponse || !storeResponse.blobId) {
        throw new Error("Failed to store blob for download");
      }
      
      console.log("Blob stored successfully with ID:", storeResponse.blobId);
      
      // Try Method 1: Direct download with blob URL
      try {
        console.log("Attempting direct download...");
        
        // Create a temporary blob URL
        const blobUrl = URL.createObjectURL(zipBlob);
        
        // Create a download link and trigger it
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;
        downloadLink.download = `${directoryName}.zip`;
        downloadLink.style.display = 'none';
        downloadLink.target = '_blank'; // Open in new tab
        
        // Add link to document and click
        document.body.appendChild(downloadLink);
        downloadLink.click();
        
        // Remove the link but keep the blob URL active
        setTimeout(() => {
          if (document.body.contains(downloadLink)) {
            document.body.removeChild(downloadLink);
          }
        }, 1000);
        
        // Set a longer timeout to revoke the URL
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
        }, 60000); // 1 minute
        
        // Download started successfully
        sendProgressUpdate(`Download initiated! ${completedFiles} files included in ZIP.`);
        
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
      }
      
      // Method 2: Use the download page
      console.log("Opening download page...");
      
      try {
        // Open the download page in a new tab
        await openDownloadPage(storeResponse.blobId, `${directoryName}.zip`, fileSizeMB);
        
        sendProgressUpdate(`Download page opened. Follow instructions there to complete the download.`);
        
        // Send completion message
        chrome.runtime.sendMessage({
          action: "downloadComplete",
          message: `Download page opened for ${completedFiles} files.`,
        }).catch(error => console.warn("Message sending error:", error));
        
        return {
          success: true,
          method: "download_page",
          totalFiles,
          filesDownloaded: completedFiles,
          filesFailed: failedFiles
        };
      } catch (pageError) {
        console.error("Error opening download page:", pageError);
        
        // Method 3: Try Chrome downloads API directly
        try {
          console.log("Trying Chrome downloads API...");
          
          const downloadResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "downloadDirectly",
              blobId: storeResponse.blobId,
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
          throw new Error("All download methods failed");
        }
      }
    } catch (error) {
      console.error("Error initiating download:", error);
      
      // Final fallback - try individual downloads
      if (confirm(`ZIP download failed. Would you like to download ${completedFiles} files individually?`)) {
        await downloadFilesIndividually(
          extractRepositoryInfo(window.location.href),
          window.location.pathname.split('/').filter(p => p.length > 0).slice(4).join('/')
        );
        return { success: true, method: "individual_files" };
      } else {
        throw new Error("Download cancelled");
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

// Fallback function to download files individually when JSZip is not available
async function downloadFilesIndividually(repoInfo, subdirectoryPath) {
  try {
    sendProgressUpdate("Preparing individual file downloads...");
    console.log("Falling back to individual file download method");
    
    // Get files list either from API or by scraping page
    let files = [];
    
    // Try GitHub API first
    try {
      const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${subdirectoryPath}?ref=${repoInfo.branch}`;
      console.log(`Fetching file list from API: ${apiUrl}`);
      
      const response = await fetch(apiUrl);
      if (response.ok) {
        const data = await response.json();
        files = data;
        console.log(`API returned ${files.length} items`);
      } else {
        throw new Error(`GitHub API error: ${response.status}`);
      }
    } catch (apiError) {
      console.error("API error, falling back to HTML scraping:", apiError);
      
      // Fall back to scraping files from the current page
      files = findFilesAndDirectoriesInCurrentPage().filter(item => !item.isDirectory);
      console.log(`Found ${files.length} files in current page`);
    }
    
    if (!files || files.length === 0) {
      throw new Error("No files found to download");
    }
    
    // Limit to a reasonable number to prevent browser issues
    const MAX_FILES = 50;
    const filesToDownload = files.slice(0, MAX_FILES);
    
    if (files.length > MAX_FILES) {
      sendProgressUpdate(`Downloading first ${MAX_FILES} of ${files.length} files...`);
    } else {
      sendProgressUpdate(`Downloading ${files.length} files individually...`);
    }
    
    // Create a temporary download link
    const downloadLink = document.createElement('a');
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    
    let successCount = 0;
    let failCount = 0;
    
    // Create a metadata file with all file information
    const metadataContent = {
      repository: `${repoInfo.owner}/${repoInfo.repo}`,
      branch: repoInfo.branch,
      subdirectory: subdirectoryPath || 'root',
      downloadDate: new Date().toISOString(),
      totalFiles: files.length,
      downloadedFiles: filesToDownload.length,
      files: files.map(file => ({
        name: file.name,
        path: file.path || file.name,
        type: file.type || 'file',
        size: file.size || 'unknown'
      }))
    };
    
    // Download metadata file
    const metadataBlob = new Blob([JSON.stringify(metadataContent, null, 2)], { type: 'application/json' });
    const metadataUrl = URL.createObjectURL(metadataBlob);
    downloadLink.href = metadataUrl;
    downloadLink.download = `${subdirectoryPath.split('/').pop() || repoInfo.repo}-files.json`;
    downloadLink.click();
    URL.revokeObjectURL(metadataUrl);
    
    // Download each file with delays between downloads
    let downloadDelay = 500; // Start with a small delay
    
    for (let i = 0; i < filesToDownload.length; i++) {
      const file = filesToDownload[i];
      
      sendProgressUpdate(`Downloading file ${i+1}/${filesToDownload.length}: ${file.name}`);
      
      try {
        // Wait to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, downloadDelay));
        
        // Get download URL - it varies based on where we got the files from
        let downloadUrl = file.download_url || file.rawUrl;
        
        // If we don't have a download URL, try to create one
        if (!downloadUrl) {
          if (file.url && file.url.includes('github.com') && file.url.includes('/blob/')) {
            // Convert GitHub blob URL to raw URL
            downloadUrl = file.url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
          } else if (file.path) {
            // Create raw URL from path
            downloadUrl = `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/${repoInfo.branch}/${file.path}`;
          }
        }
        
        if (!downloadUrl) {
          console.error("Missing download URL for file:", file);
          failCount++;
          continue;
        }
        
        // Fetch the file
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          failCount++;
          console.error(`Failed to download ${file.name}: ${response.status}`);
          continue;
        }
        
        // Create blob and download
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Get a sensible filename
        const filename = file.name || file.path?.split('/').pop() || 'file-' + i;
        
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.click();
        
        // Revoke the blob URL after a short delay
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
        successCount++;
        
        // Adjust delay based on file size to prevent browser issues
        if (blob.size > 1000000) { // For files > 1MB
          downloadDelay = 1000; // Increase delay for larger files
        }
      } catch (error) {
        console.error(`Error downloading file ${file.name}:`, error);
        failCount++;
      }
    }
    
    // Clean up
    document.body.removeChild(downloadLink);
    
    // Send completion message
    chrome.runtime.sendMessage({
      action: "downloadComplete",
      message: `Downloaded ${successCount} files individually${failCount > 0 ? ` (${failCount} failed)` : ''}`,
    }).catch(error => console.warn("Message sending error:", error));
    
    return { successCount, failCount };
  } catch (error) {
    console.error("Error in individual file download:", error);
    
    // Send error message
    chrome.runtime.sendMessage({
      action: "downloadError",
      message: error.message || "Failed to download files individually",
    }).catch(e => console.warn("Failed to send error message:", e));
    
    throw error;
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
      const downloadUrl = chrome.runtime.getURL("download.html") + 
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
