// Background service worker for GitHub Repository Downloader

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
  
  // Return true to indicate an asynchronous response
  return true;
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
