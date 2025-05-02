// Background script for GitHub Repository Downloader

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward progress updates to popup if it's open
  if (message.action === "updateProgress" || 
      message.action === "downloadComplete" || 
      message.action === "downloadError") {
    
    // Get all windows
    chrome.windows.getAll({ populate: true }, (windows) => {
      // Loop through all windows and tabs
      windows.forEach((window) => {
        // Forward message to all tabs that have our extension popup open
        window.tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, message, (response) => {
            // Ignore error if no listener on that tab
            if (chrome.runtime.lastError) {
              // This is expected for tabs without our content script
            }
          });
        });
      });
    });
  }
  
  // Always return true to indicate we'll send a response asynchronously
  return true;
});

// Log when the extension is installed
chrome.runtime.onInstalled.addListener((details) => {
  console.log("GitHub Repository Downloader installed:", details.reason);
});

// Initialize the extension
console.log("GitHub Repository Downloader background script loaded");
