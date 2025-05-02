document.addEventListener("DOMContentLoaded", () => {
  const downloadBtn = document.getElementById("download-btn");
  const container = document.getElementById("container");

  // Create status element if it doesn't exist
  let statusDiv = document.getElementById("status");
  if (!statusDiv) {
    statusDiv = document.createElement("div");
    statusDiv.id = "status";
    statusDiv.style.marginBottom = "10px";
    statusDiv.style.display = "none";
    container.insertBefore(statusDiv, downloadBtn);
  }

  // Listen for status updates from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.action === "updateProgress" ||
      message.action === "downloadComplete" ||
      message.action === "downloadError"
    ) {
      statusDiv.style.display = "block";
      statusDiv.textContent = message.message;
      
      // Add color based on message type
      if (message.action === "downloadError") {
        statusDiv.style.backgroundColor = "#ffebe9";
        statusDiv.style.borderColor = "#ffbbc0";
        statusDiv.style.color = "#cf222e";
      } else if (message.action === "downloadComplete") {
        statusDiv.style.backgroundColor = "#dafbe1";
        statusDiv.style.borderColor = "#aceebb";
        statusDiv.style.color = "#116329";
        
        // Hide status after a delay on success
        setTimeout(() => {
          statusDiv.style.display = "none";
        }, 3000);
      } else {
        // In progress
        statusDiv.style.backgroundColor = "#f1f8ff";
        statusDiv.style.borderColor = "#d1e4fc";
        statusDiv.style.color = "#0366d6";
      }
    }
  });

  // Handle download button click
  downloadBtn.addEventListener("click", () => {
    // Get the current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (!currentTab) {
        showError("No active tab found");
        return;
      }
      
      const currentUrl = currentTab.url;

      // Check if it's a GitHub URL
      if (!currentUrl || !currentUrl.includes("github.com")) {
        showError("Not a GitHub page");
        return;
      }

      // Parse the URL
      const urlParts = currentUrl.split("/");
      const githubIndex = urlParts.findIndex(part => part === "github.com" || part.endsWith("github.com"));

      if (githubIndex === -1 || githubIndex + 2 >= urlParts.length) {
        showError("Not a valid GitHub repository URL");
        return;
      }

      // Show status
      showStatus("Preparing download...");

      const owner = urlParts[githubIndex + 1];
      const repo = urlParts[githubIndex + 2];

      // Check if we're in a subdirectory
      const isSubdirectory = urlParts.length > githubIndex + 4 && 
                             urlParts[githubIndex + 3] === "tree";

      if (isSubdirectory) {
        // We're in a subdirectory - use content script to download
        showStatus("Initializing download...");

        chrome.tabs.sendMessage(
          currentTab.id,
          { action: "downloadSubdirectory" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Error:", chrome.runtime.lastError);
              showError("Error: Content script not ready. Please refresh the GitHub page and try again.");
            } else if (response && !response.success) {
              showError(response.message || "Download failed");
            }
          }
        );
      } else {
        // Check which branch we're on (main or master)
        checkDefaultBranch(owner, repo)
          .then(branch => {
            // We're at the repository root - use GitHub's ZIP download
            const downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;

            showStatus("Downloading repository...");

            // Create download link
            const downloadLink = document.createElement("a");
            downloadLink.href = downloadUrl;
            downloadLink.download = `${repo}.zip`;

            // Trigger download
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

            showSuccess("Download initiated!");
          })
          .catch(error => {
            console.error("Branch check error:", error);
            // Fall back to main if we can't determine the branch
            const downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
            
            showStatus("Downloading repository (using main branch)...");
            
            const downloadLink = document.createElement("a");
            downloadLink.href = downloadUrl;
            downloadLink.download = `${repo}.zip`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            showSuccess("Download initiated!");
          });
      }
    });
  });
  
  // Helper function to show error messages
  function showError(message) {
    statusDiv.style.display = "block";
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = "#ffebe9";
    statusDiv.style.borderColor = "#ffbbc0";
    statusDiv.style.color = "#cf222e";
  }
  
  // Helper function to show status messages
  function showStatus(message) {
    statusDiv.style.display = "block";
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = "#f1f8ff";
    statusDiv.style.borderColor = "#d1e4fc";
    statusDiv.style.color = "#0366d6";
  }
  
  // Helper function to show success messages
  function showSuccess(message) {
    statusDiv.style.display = "block";
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = "#dafbe1";
    statusDiv.style.borderColor = "#aceebb";
    statusDiv.style.color = "#116329";
    
    // Hide after a delay
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 3000);
  }
  
  // Helper function to check repository's default branch (main or master)
  async function checkDefaultBranch(owner, repo) {
    try {
      // Try to fetch the repo API to determine the default branch
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
      if (response.ok) {
        const data = await response.json();
        return data.default_branch || 'main';
      }
      return 'main'; // Default to 'main' if API call fails
    } catch (error) {
      console.error("Error checking default branch:", error);
      return 'main'; // Default to 'main' on error
    }
  }
});
