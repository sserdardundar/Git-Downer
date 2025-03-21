document.addEventListener("DOMContentLoaded", () => {
  const downloadBtn = document.getElementById("download-btn");
  const container = document.getElementById("container");

  // Create status element
  const statusDiv = document.createElement("div");
  statusDiv.id = "status";
  statusDiv.style.marginBottom = "10px";
  statusDiv.style.display = "none";
  container.insertBefore(statusDiv, downloadBtn);

  // Listen for status updates from the content script via background
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.action === "updateProgress" ||
      message.action === "downloadComplete" ||
      message.action === "downloadError"
    ) {
      statusDiv.style.display = "block";
      statusDiv.textContent = message.message;

      if (message.action === "downloadComplete") {
        setTimeout(() => {
          statusDiv.style.display = "none";
        }, 3000);
      }
    }
  });

  // Handle download button click
  downloadBtn.addEventListener("click", () => {
    // Get the current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs[0].url;

      // Check if it's a GitHub URL
      if (!currentUrl.includes("github.com")) {
        alert("Not a GitHub page!");
        return;
      }

      // Parse the URL
      const urlParts = currentUrl.split("/");
      const githubIndex = urlParts.indexOf("github.com");

      if (githubIndex === -1 || githubIndex + 2 >= urlParts.length) {
        alert("Not a valid GitHub repository URL!");
        return;
      }

      // Show status
      statusDiv.style.display = "block";
      statusDiv.textContent = "Preparing download...";

      const owner = urlParts[githubIndex + 1];
      const repo = urlParts[githubIndex + 2];

      // Check if we're in a subdirectory
      if (
        urlParts.length > githubIndex + 4 &&
        urlParts[githubIndex + 3] === "tree"
      ) {
        // We're in a subdirectory - use content script to download
        statusDiv.textContent = "Downloading subdirectory...";

        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "downloadSubdirectory" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Error:", chrome.runtime.lastError);
              statusDiv.textContent =
                "Error: Content script not ready. Please refresh the GitHub page and try again.";
            }
          }
        );
      } else {
        // We're at the repository root - use GitHub's ZIP download
        const downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;

        statusDiv.textContent = "Downloading repository...";

        // Create download link
        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = `${repo}.zip`;

        // Trigger download
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        statusDiv.textContent = "Download complete!";

        // Hide status after a delay
        setTimeout(() => {
          statusDiv.style.display = "none";
        }, 3000);
      }
    });
  });
});
