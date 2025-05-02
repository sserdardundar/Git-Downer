// Background service worker for GitHub Repository Downloader

// Storage for temporary blobs (will be cleared when the extension is reloaded)
const blobStorage = new Map();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward progress updates to popup if it's open
  if (message.action === "updateProgress" || 
      message.action === "downloadComplete" || 
      message.action === "downloadError") {
    
    // Forward message to all tabs with our extension's content script
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        // Only send to github.com tabs
        if (tab.url && tab.url.includes('github.com')) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
            // Ignore errors for tabs that don't have our content script
            // This is normal and expected
          });
        }
      });
    });
  }
  
  // Handle storing a blob for download
  if (message.action === "storeBlob") {
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
      
      // Generate a unique ID for this blob
      const blobId = 'blob_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
      
      // Log blob details
      console.log(`Storing blob: id=${blobId}, type=${message.blob.type}, size=${message.blob.size} bytes`);
      
      // Store the blob reference
      blobStorage.set(blobId, {
        blob: message.blob,
        filename: message.filename,
        timestamp: Date.now(),
        size: message.blob.size
      });
      
      // Set a cleanup timer (remove blob after 15 minutes)
      setTimeout(() => {
        if (blobStorage.has(blobId)) {
          console.log(`Removing expired blob ${blobId}`);
          blobStorage.delete(blobId);
        }
      }, 15 * 60 * 1000);
      
      // Return the blob ID
      sendResponse({ 
        success: true, 
        blobId: blobId,
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
  if (message.action === "requestDownloadBlob") {
    const blobId = message.blobId;
    console.log("Background script: Request to get blob", blobId);
    
    if (!blobId || !blobStorage.has(blobId)) {
      console.error(`Blob with ID ${blobId} not found`);
      sendResponse({ 
        success: false, 
        error: "Blob not found or has expired" 
      });
      return true;
    }
    
    const blobData = blobStorage.get(blobId);
    console.log(`Retrieved blob for ${blobData.filename}`);
    
    sendResponse({
      success: true,
      blob: blobData.blob,
      filename: blobData.filename
    });
    
    return true;
  }
  
  // Handle opening the download page
  if (message.action === "openDownloadPage") {
    try {
      const blobId = message.blobId;
      const filename = message.filename;
      const fileSize = message.fileSize || 0;
      const autoStart = message.autoStart || false;
      
      console.log(`Opening download page for blob ${blobId}, file: ${filename}`);
      
      // Construct the download page URL with parameters
      const downloadUrl = chrome.runtime.getURL("download.html") + 
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
  if (message.action === "downloadDirectly") {
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
        filename: filename,
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
                  // Remove the listener once download is complete
                  chrome.downloads.onChanged.removeListener(downloadListener);
                  
                  // Revoke the blob URL after the download is complete
                  setTimeout(() => {
                    URL.revokeObjectURL(url);
                    console.log("Revoked blob URL after download");
                  }, 5000);
                } else if (delta.state.current === "interrupted") {
                  console.error(`Download ${downloadId} interrupted:`, delta.error?.current);
                  // Remove the listener on interruption
                  chrome.downloads.onChanged.removeListener(downloadListener);
                  URL.revokeObjectURL(url);
                }
              }
            }
          });
          
          sendResponse({ success: true, downloadId });
        }
      });
    } catch (error) {
      console.error("Error starting direct download:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the messaging channel open
  }
  
  // Add handler for loading JSZip from background
  if (message.action === "loadJSZip") {
    console.log("Background script: Request to load JSZip received");
    
    // Load the JSZip library using fetch
    const jsZipUrl = chrome.runtime.getURL("jszip.min.js");
    console.log("Loading JSZip from:", jsZipUrl);
    
    fetch(jsZipUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch JSZip: ${response.status}`);
        }
        return response.text();
      })
      .then(jsZipCode => {
        console.log("JSZip loaded in background, size:", jsZipCode.length);
        
        // Send back success response
        sendResponse({ 
          success: true,
          message: "JSZip loaded from background service worker" 
        });
        
        // Inject script into the page
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          files: ["jszip.min.js"]
        }).then(() => {
          console.log("JSZip injected into page");
        }).catch(err => {
          console.error("Error injecting JSZip:", err);
        });
      })
      .catch(error => {
        console.error("Error loading JSZip in background:", error);
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  }
  
  // Handler for direct URL-based download from download.html
  if (message.action === "downloadWithUrl") {
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
  if (message.action === "openTab") {
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

// Log that the service worker has started
console.log("GitHub Repository Downloader service worker started");
