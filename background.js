// Listen for messages from both popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward progress updates from content script to popup
  if (
    message.action === "updateProgress" ||
    message.action === "downloadComplete" ||
    message.action === "downloadError"
  ) {
    // Find the popup and forward the message
    chrome.runtime.sendMessage(message);
  }

  // Return true if we're going to send response asynchronously
  return true;
});
