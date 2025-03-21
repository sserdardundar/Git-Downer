// This content script runs in the context of GitHub pages
let jsZipLoaded = false;

// Function to inject JSZip library
function injectJSZip() {
  return new Promise((resolve, reject) => {
    if (jsZipLoaded) {
      resolve();
      return;
    }

    // Create a script tag to inject jszip from extension
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("jszip.min.js");
    script.onload = () => {
      jsZipLoaded = true;
      resolve();
    };
    script.onerror = (error) => {
      reject(new Error("Failed to load JSZip: " + error.message));
    };
    document.head.appendChild(script);
  });
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadSubdirectory") {
    // Start the download process
    downloadSubdirectory()
      .then((result) => {
        sendResponse({ success: true, message: "Download complete!" });
      })
      .catch((error) => {
        console.error("Download error:", error);
        sendResponse({ success: false, message: error.message });
      });

    // Return true to indicate we'll send a response asynchronously
    return true;
  }
});

// Function to download the current subdirectory
async function downloadSubdirectory() {
  try {
    // Inject JSZip
    await injectJSZip();

    // Get current path information
    const currentPath = window.location.pathname;
    const pathParts = currentPath.split("/");

    // Get owner, repo, branch, and directory
    const owner = pathParts[1];
    const repo = pathParts[2];
    const branch = pathParts[4];
    const directory = pathParts.slice(5).join("/");
    const directoryName = pathParts[pathParts.length - 1] || repo;

    // Send initial progress update
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: "Finding files...",
    });

    // Find all files in the current directory
    // GitHub uses different DOM structures, so we try multiple selectors
    let fileElements = [];

    // Try modern GitHub file rows
    fileElements = Array.from(document.querySelectorAll(".Box-row"));
    console.log("Box-row elements found:", fileElements.length);

    // If no files found, try alternative selectors
    if (fileElements.length === 0) {
      fileElements = Array.from(
        document.querySelectorAll("tr.react-directory-row")
      );
      console.log(
        "tr.react-directory-row elements found:",
        fileElements.length
      );
    }

    // Additional selectors for different GitHub structures
    if (fileElements.length === 0) {
      fileElements = Array.from(
        document.querySelectorAll(".js-navigation-open")
      );
      console.log(".js-navigation-open elements found:", fileElements.length);
    }

    if (fileElements.length === 0) {
      fileElements = Array.from(
        document.querySelectorAll(".js-details-container .js-navigation-item")
      );
      console.log(
        ".js-details-container .js-navigation-item elements found:",
        fileElements.length
      );
    }

    if (fileElements.length === 0) {
      throw new Error("No files found in this directory");
    }

    // Extract file information
    const files = [];

    fileElements.forEach((el) => {
      // Skip parent directory entry
      if (el.querySelector('[aria-label="parent directory"]')) {
        return;
      }

      let fileName = "";
      let filePath = "";
      let isDirectory = false;

      // Try to get file name and path
      const fileLink = el.querySelector('a[href*="blob/"], a[href*="tree/"]');
      if (fileLink) {
        fileName = fileLink.textContent.trim();
        // Correctly slice the path to get the file path
        filePath = fileLink.getAttribute("href").split("/").slice(5).join("/");
        // Prepend owner, repo, and branch to the file path
        filePath = `${directory}/${filePath}`;
        isDirectory = fileLink.getAttribute("href").includes("/tree/");
      }

      if (fileName && filePath) {
        files.push({ name: fileName, path: filePath, isDirectory });
        console.log(
          `File found: ${fileName}, Path: ${filePath}, Is Directory: ${isDirectory}`
        );
      }
    });

    if (files.length === 0) {
      throw new Error("No valid files found in this directory");
    }

    // Use the XMLHttpRequest approach to download files
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: `Found ${files.length} items to process...`,
    });

    // Create a downloadable ZIP
    await createAndDownloadZip(owner, repo, branch, files, directoryName);

    return { success: true };
  } catch (error) {
    console.error("Download error:", error);
    chrome.runtime.sendMessage({
      action: "downloadError",
      message: error.message,
    });
    throw error;
  }
}

// Function to create and download a ZIP file
async function createAndDownloadZip(owner, repo, branch, files, directoryName) {
  // Create a message channel to communicate with the injected script
  const channel = new MessageChannel();
  const port = channel.port1;

  return new Promise((resolve, reject) => {
    // Listen for messages from the injected script
    port.onmessage = (event) => {
      const { type, data } = event.data;

      if (type === "progress") {
        chrome.runtime.sendMessage({
          action: "updateProgress",
          message: data.message,
        });
      } else if (type === "complete") {
        // Download the ZIP file
        const blob = new Blob([data.zipData], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${directoryName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        chrome.runtime.sendMessage({
          action: "downloadComplete",
          message: "Download complete!",
        });

        resolve();
      } else if (type === "error") {
        reject(new Error(data.message));
      }
    };

    // Create and inject a script to handle ZIP creation in the page context
    const script = document.createElement("script");
    script.textContent = `
      (function() {
        // Function to process files and create a ZIP
        async function processFiles() {
          try {
            // Make sure JSZip is available
            if (typeof JSZip !== 'function') {
              throw new Error("JSZip not available");
            }
            
            const zip = new JSZip();
            const rootFolder = zip.folder("${directoryName}");
            const files = ${JSON.stringify(files)};
            let completed = 0;
            
            // Add files to the ZIP
            for (const file of files) {
              if (!file.isDirectory) {
                try {
                  // Download the file
                  console.log("Downloading file:", file.path);
                  const rawUrl = \`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${
      file.path
    }\`;
                  const response = await fetch(rawUrl);
                  
                  if (!response.ok) {
                    throw new Error(\`Failed to download \${file.name}: \${response.status}\`);
                  }
                  
                  const blob = await response.blob();
                  rootFolder.file(file.name, blob);
                  
                  // Update progress
                  completed++;
                  window.postMessage(
                    { type: 'progress', data: { message: \`Downloading \${completed} of \${files.filter(f => !f.isDirectory).length} files...\` } },
                    '*'
                  );
                } catch (fileError) {
                  console.error(\`Error processing \${file.name}:\`, fileError);
                }
              }
            }
            
            // Generate the ZIP file
            const zipData = await zip.generateAsync({ 
              type: "arraybuffer",
              compression: "DEFLATE"
            });
            
            // Send the ZIP data back
            window.postMessage(
              { type: 'complete', data: { zipData } },
              '*'
            );
          } catch (error) {
            console.error("ZIP creation error:", error);
            window.postMessage(
              { type: 'error', data: { message: error.message } },
              '*'
            );
          }
        }
        
        // Start processing files
        processFiles();
      })();
    `;

    // Set up communication with injected script
    window.addEventListener("message", (event) => {
      // Make sure the message is from our page
      if (event.source !== window) return;

      const { type, data } = event.data;
      if (type === "progress" || type === "complete" || type === "error") {
        port.postMessage({ type, data });
      }
    });

    // Inject the script
    document.body.appendChild(script);
    document.body.removeChild(script);
  });
}

// Notify that the content script is loaded
console.log("GitHub Repo Downloader content script loaded");
