// Background service worker for GitHub Repository Downloader

// Storage for temporary blobs (will be cleared when the extension is reloaded)
const blobStorage = new Map();

// Utility functions
const utils = {
  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 255);
  },
  
  generateBlobId() {
    return `blob_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  },
  
  cleanupBlob(blobId, delay = 15 * 60 * 1000) {
    setTimeout(() => {
      if (blobStorage.has(blobId)) {
        console.log(`Removing expired blob: ${blobId}`);
        blobStorage.delete(blobId);
      }
    }, delay);
  }
};

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;
  
  // Forward progress updates to all GitHub tabs
  if (['updateProgress', 'downloadComplete', 'downloadError'].includes(action)) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.url?.includes('github.com')) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      });
    });
    return;
  }
  
  // Handle executeScript action - CSP-compliant script injection
  if (action === "executeScript") {
    try {
      console.log("Executing script via chrome.scripting API");
      
      if (!sender.tab || !sender.tab.id) {
        console.error("No tab ID available for script injection");
        sendResponse({ success: false, error: "No tab ID available" });
        return true;
      }
      
      // Get script path relative to the extension root
      const scriptPath = message.scriptUrl ? 
          message.scriptUrl.replace(chrome.runtime.getURL(''), '') : 
          'lib/jszip.min.js';
          
      console.log("Injecting script:", scriptPath);
      
      // Use chrome.scripting API to inject the script properly
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        files: [scriptPath]
      })
      .then(() => {
        console.log("Script injection successful via chrome.scripting API");
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("Script injection error:", error);
        sendResponse({ success: false, error: error.message });
      });
      
      return true; // Keep messaging channel open for async response
    } catch (error) {
      console.error("Error in executeScript action:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
  
  // Handle storing a blob for download
  if (action === "storeBlob") {
    try {
      console.log("Received request to store blob for download:", message.filename);
      
      // Verify we have a blob to store
      if (!message.blob) {
        console.error("No blob data provided");
        sendResponse({ 
          success: false, 
          error: "No blob data provided" 
        });
        return true;
      }
      
      const blobId = utils.generateBlobId();
      
      // Log blob details
      console.log(`Storing blob: id=${blobId}, type=${message.blob.type}, size=${message.blob.size} bytes`);
      
      // Store the blob reference
      blobStorage.set(blobId, {
        blob: message.blob,
        filename: utils.sanitizeFilename(message.filename || 'download.zip'),
        timestamp: Date.now(),
        size: message.blob.size
      });
      
      // Set a cleanup timer (remove blob after 15 minutes)
      utils.cleanupBlob(blobId);
      
      // Return the blob ID
      sendResponse({ 
        success: true, 
        blobId,
        message: "Blob stored successfully"
      });
    } catch (error) {
      console.error("Error storing blob:", error);
      sendResponse({ 
        success: false, 
        error: "Failed to store blob: " + error.message 
      });
    }
    return true; // Keep the messaging channel open
  }
  
  // Handle blob retrieval request from the download page
  if (action === "requestDownloadBlob") {
    const { blobId } = message;
    console.log("Background script: Request to get download blob", blobId);
    
    if (!blobId || !blobStorage.has(blobId)) {
      console.error(`Blob with ID ${blobId} not found`);
      sendResponse({ 
        success: false, 
        error: "Blob not found or has expired" 
      });
      return true;
    }
    
    const blobInfo = blobStorage.get(blobId);
    console.log(`Retrieved blob info for ${blobInfo.filename}`, blobInfo);
    
    // If this is a download ID-based blob, we need to get the file data
    if (blobInfo.downloadId) {
      // We need to open the file using chrome.downloads.open
      chrome.downloads.open(blobInfo.downloadId);
      
      // Since we can't directly access the file contents due to Chrome's security model,
      // we'll tell the content script to use the downloadRepositoryZip method instead
      sendResponse({
        success: false, 
        useDownloadAPI: true,
        error: "Direct blob access not supported for downloaded files. Use chrome.downloads.download instead.",
        downloadUrl: blobInfo.originalUrl,
        filename: blobInfo.filename,
        size: blobInfo.size
      });
      return true;
    }
    
    // For regular blobs we stored directly
    sendResponse({
      success: true,
      blob: blobInfo.blob,
      filename: blobInfo.filename,
      size: blobInfo.size
    });
    
    return true;
  }
  
  // Handle opening the download page
  if (action === "openDownloadPage") {
    try {
      const { blobId, filename, fileSize = 0, autoStart = false } = message;
      
      console.log(`Opening download page for blob ${blobId}, file: ${filename}`);
      
      // Construct the download page URL with parameters
      const downloadUrl = chrome.runtime.getURL("html/download.html") + 
        `?blobId=${encodeURIComponent(blobId)}` +
        `&fileName=${encodeURIComponent(filename)}` +
        `&fileSize=${encodeURIComponent(fileSize)}` +
        `&autoStart=${autoStart}`;
      
      // Open the download page in a new tab
      chrome.tabs.create({ 
        url: downloadUrl,
        active: true
      }, (tab) => {
        console.log(`Opened download page in tab ${tab.id}`);
        sendResponse({ success: true, tabId: tab.id });
      });
    } catch (error) {
      console.error("Error opening download page:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the messaging channel open
  }
  
  // Handle direct downloads with blob ID
  if (action === "downloadDirectly") {
    try {
      console.log("Received request for direct download:", message.filename);
      
      // Get the blob from storage
      const blobId = message.blobId;
      if (!blobId || !blobStorage.has(blobId)) {
        console.error(`Blob with ID ${blobId} not found`);
        sendResponse({
          success: false,
          error: "Blob not found or expired"
        });
        return true;
      }
      
      const blobData = blobStorage.get(blobId);
      const blob = blobData.blob;
      const filename = message.filename || blobData.filename;
      
      // Create a blob URL
      const url = URL.createObjectURL(blob);
      console.log("Created blob URL for download:", url);
      
      // Use Chrome's downloads API with more reliable options
      chrome.downloads.download({
        url: url,
        filename: utils.sanitizeFilename(filename),
        saveAs: message.saveAs || false,
        headers: [
          { name: "Content-Type", "value": "application/zip" }
        ],
        conflictAction: "uniquify"
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Download error:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          URL.revokeObjectURL(url);
        } else if (downloadId === undefined) {
          console.error("Download failed, no ID returned");
          sendResponse({ success: false, error: "Download failed to start" });
          URL.revokeObjectURL(url);
        } else {
          console.log("Download started with ID:", downloadId);
          
          // Track this download to monitor its progress
          chrome.downloads.onChanged.addListener(function downloadListener(delta) {
            if (delta.id === downloadId) {
              if (delta.state) {
                console.log(`Download ${downloadId} state: ${delta.state.current}`);
                
                if (delta.state.current === "complete") {
                  console.log(`Download ${downloadId} completed successfully`);
                  // Cleanup
                  URL.revokeObjectURL(url);
                  chrome.downloads.onChanged.removeListener(downloadListener);
                  // We don't send a response here as the response has already been sent
                } else if (delta.state.current === "interrupted") {
                  console.error(`Download ${downloadId} was interrupted`);
                  URL.revokeObjectURL(url);
                  chrome.downloads.onChanged.removeListener(downloadListener);
                }
              }
            }
          });
          
          // Send the success response
          sendResponse({ 
            success: true, 
            downloadId: downloadId,
            message: "Download initiated successfully"
          });
        }
      });
    } catch (error) {
      console.error("Error initiating download:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the messaging channel open
  }
  
  // Handle downloadBlob action for data URLs
  if (action === "downloadBlob") {
    try {
      console.log("Received request to download blob from data URL:", message.filename);
      
      if (!message.dataUrl) {
        console.error("No data URL provided for download");
        sendResponse({ success: false, error: "No data URL provided" });
        return true;
      }
      
      const filename = message.filename || `download_${Date.now()}.zip`;
      
      // Use Chrome's downloads API with the data URL
      chrome.downloads.download({
        url: message.dataUrl,
        filename: filename,
        saveAs: message.saveAs || false,
        conflictAction: "uniquify"
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Download error:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else if (downloadId === undefined) {
          console.error("Download failed, no ID returned");
          sendResponse({ success: false, error: "Download failed to start" });
        } else {
          console.log("Download started with ID:", downloadId);
          sendResponse({ 
            success: true, 
            downloadId: downloadId,
            message: "Download initiated successfully"
          });
        }
      });
    } catch (error) {
      console.error("Error initiating download from data URL:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the messaging channel open
  }
  
  // Add handler for loading JSZip from background
  if (action === "loadJSZip") {
    try {
      console.log("Loading JSZip from background service worker");
      
      // Return the URL to the JSZip library instead of the code itself
      // This is more CSP-friendly
      const jsZipUrl = chrome.runtime.getURL('lib/jszip.min.js');
      console.log("Providing JSZip URL:", jsZipUrl);
      
      sendResponse({
        success: true,
        jsZipUrl: jsZipUrl
      });
      
      return true; // Keep the messaging channel open
    } catch (error) {
      console.error("Error in loadJSZip:", error);
      sendResponse({
        success: false,
        error: error.message
      });
      return true;
    }
  }
  
  // Handler for direct URL-based download from download.html
  if (action === "downloadWithUrl") {
    try {
      console.log("Received request for URL-based download:", message.filename);
      
      if (!message.url) {
        console.error("No URL provided for download");
        sendResponse({ success: false, error: "No URL provided" });
        return true;
      }
      
      // Use Chrome's downloads API
      chrome.downloads.download({
        url: message.url,
        filename: message.filename,
        saveAs: false,
        headers: [
          { name: "Content-Type", value: "application/zip" }
        ],
        conflictAction: "uniquify"
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Download error:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else if (downloadId === undefined) {
          console.error("Download failed, no ID returned");
          sendResponse({ success: false, error: "Download failed to start" });
        } else {
          console.log("Download started with ID:", downloadId);
          sendResponse({ success: true, downloadId: downloadId });
        }
      });
      
      return true; // Keep the message channel open
    } catch (error) {
      console.error("Error starting URL-based download:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
  
  // Handle opening tabs
  if (action === "openTab") {
    try {
      console.log("Opening tab:", message.url);
      
      if (!message.url) {
        console.error("No URL provided");
        sendResponse({ success: false, error: "No URL provided" });
        return true;
      }
      
      // Open the URL in a new tab
      chrome.tabs.create({ 
        url: message.url,
        active: true
      }, (tab) => {
        if (chrome.runtime.lastError) {
          console.error("Error opening tab:", chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log("Tab opened with ID:", tab.id);
          sendResponse({ success: true, tabId: tab.id });
        }
      });
      
      return true; // Keep the message channel open
    } catch (error) {
      console.error("Error opening tab:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
  
  // Handle repository download request (bypasses CORS)
  if (action === "downloadRepositoryZip") {
    handleRepositoryZipDownload(message, sendResponse);
    return true;
  }
  
  // Handle repository download request for subdirectory extraction
  if (action === "downloadRepositoryForExtraction") {
    try {
      console.log("Background script: Downloading repository ZIP for extraction:", message.url);
      
      // Instead of using fetch (which can be blocked by CORS), use Chrome's downloads API
      // First create a temporary file name for the download
      const tempFileName = `repo_${Date.now()}.zip`;
      
      // Use Chrome's downloads API to download the file
      chrome.downloads.download({
        url: message.url,
        filename: tempFileName,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Repository download error:", chrome.runtime.lastError);
          sendResponse({
            success: false, 
            error: chrome.runtime.lastError.message
          });
          return;
        }
        
        if (downloadId === undefined) {
          console.error("Repository download failed, no ID returned");
          sendResponse({
            success: false,
            error: "Download failed to start"
          });
          return;
        }
        
        console.log(`Repository download started with ID: ${downloadId}`);
        
        // Monitor the download progress
        const downloadListener = function(delta) {
          if (delta.id !== downloadId) return;
          
          // Check if download state changed
          if (delta.state) {
            if (delta.state.current === "complete") {
              console.log(`Repository download ${downloadId} completed`);
              
              // Get download information
              chrome.downloads.search({id: downloadId}, function(downloadItems) {
                if (downloadItems && downloadItems.length > 0) {
                  const downloadItem = downloadItems[0];
                  console.log(`Download completed: ${downloadItem.filename}, size: ${downloadItem.fileSize} bytes`);
                  
                  // Create a blobId for tracking
                  const blobId = 'repo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
                  
                  // Store download info for processing by content script
                  blobStorage.set(blobId, {
                    downloadId: downloadId,
                    filename: downloadItem.filename,
                    originalUrl: message.url,
                    timestamp: Date.now(),
                    size: downloadItem.fileSize
                  });
                  
                  // Return success with the blobId
                  sendResponse({
                    success: true,
                    blobId: blobId,
                    size: downloadItem.fileSize,
                    filename: downloadItem.filename
                  });
                  
                  // Remove the listener
                  chrome.downloads.onChanged.removeListener(downloadListener);
                } else {
                  sendResponse({
                    success: false,
                    error: "Could not find download information"
                  });
                  chrome.downloads.onChanged.removeListener(downloadListener);
                }
              });
            } 
            else if (delta.state.current === "interrupted") {
              console.error(`Repository download ${downloadId} interrupted`, delta.error);
              sendResponse({
                success: false,
                error: `Download interrupted: ${delta.error?.current || "Unknown error"}`
              });
              chrome.downloads.onChanged.removeListener(downloadListener);
            }
          }
        };
        
        // Add the listener for download state changes
        chrome.downloads.onChanged.addListener(downloadListener);
      });
      
      return true; // Keep message channel open for async response
    } catch (error) {
      console.error("Error handling repository download for extraction:", error);
      sendResponse({
        success: false,
        error: error.message
      });
      return true;
    }
  }
  
  // Return true to indicate an asynchronous response
  return true;
});

// Listen for download state changes
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state) {
    console.log(`Download ${downloadDelta.id} changed state to: ${downloadDelta.state.current}`);
    
    if (downloadDelta.state.current === 'complete') {
      console.log(`Download ${downloadDelta.id} completed successfully`);
    } else if (downloadDelta.state.current === 'interrupted') {
      console.error(`Download ${downloadDelta.id} was interrupted`);
    }
  }
});

// Cleanup function to run when extension is unloaded or browser is closed
chrome.runtime.onSuspend.addListener(() => {
  console.log("Extension is being unloaded, cleaning up...");
  blobStorage.clear();
});

// Listen for when the extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  console.log("GitHub Repository Downloader installed:", details.reason);
  
  // Set up context menu if needed
  // chrome.contextMenus.create({...}) could be added here
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getStatus") {
    // Could be used to get the current download status if implemented
    sendResponse({ status: "idle" });
  }
});

// Repository ZIP download handler
function handleRepositoryZipDownload(message, sendResponse) {
  const { url, filename, timeoutMs = 120000 } = message;
  
  if (!url) {
    sendResponse({ success: false, error: 'No URL provided' });
    return;
  }
  
  console.log(`Starting repository ZIP download: ${url}`);
  
  const timeoutId = setTimeout(() => {
    sendResponse({ success: false, error: 'Download timeout' });
  }, timeoutMs);
  
  // Use fetch with timeout
  const controller = new AbortController();
  const fetchTimeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  fetch(url, { 
    signal: controller.signal,
    method: 'GET',
    cache: 'no-store'
  })
  .then(response => {
    clearTimeout(fetchTimeoutId);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.blob();
  })
  .then(blob => {
    console.log(`Repository ZIP fetched: ${blob.size} bytes`);
    
    // Store the blob
    const blobId = utils.generateBlobId();
    
    blobStorage.set(blobId, {
      blob: blob,
      filename: utils.sanitizeFilename(filename),
      timestamp: Date.now(),
      size: blob.size,
      originalUrl: url
    });
    
    utils.cleanupBlob(blobId);
    
    sendResponse({
      success: true,
      blobId: blobId,
      size: blob.size,
      filename: utils.sanitizeFilename(filename),
      message: 'Repository ZIP downloaded successfully'
    });
  })
  .catch(error => {
    clearTimeout(fetchTimeoutId);
    clearTimeout(timeoutId);
    
    console.error('Repository ZIP download failed:', error);
    
    if (error.name === 'AbortError') {
      sendResponse({ success: false, error: 'Download was aborted due to timeout' });
    } else {
      sendResponse({ success: false, error: error.message });
    }
  });
}

// Cleanup old blobs on extension startup
chrome.runtime.onStartup.addListener(() => {
  blobStorage.clear();
  console.log('Extension startup: Cleared blob storage');
});

// Log that the service worker has started
console.log("GitHub Repository Downloader service worker started");
