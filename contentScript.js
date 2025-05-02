// This content script runs in the context of GitHub pages
let jsZip = null;

// Function to load JSZip library
async function loadJSZip() {
  if (jsZip) {
    return jsZip;
  }

  try {
    console.log("Loading JSZip library...");
    // Get the URL to the JSZip file
    const jsZipUrl = chrome.runtime.getURL("jszip.min.js");
    console.log("JSZip URL:", jsZipUrl);

    // Fetch the JSZip library content
    const response = await fetch(jsZipUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JSZip: ${response.status}`);
    }

    const jsZipCode = await response.text();
    console.log("JSZip loaded, size:", jsZipCode.length, "bytes");

    // Create a blob URL for the JSZip code
    const blob = new Blob([jsZipCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    // Create a script tag to dynamically load JSZip
    return new Promise((resolve, reject) => {
      // Use dynamic import to load JSZip
      import(blobUrl)
        .then(module => {
          console.log("JSZip imported successfully");
          URL.revokeObjectURL(blobUrl);
          
          // Try to load JSZip from the window object
          if (window.JSZip) {
            console.log("JSZip found on window object");
            jsZip = window.JSZip;
            resolve(jsZip);
          } else {
            console.log("Using JSZip from npm module");
            // If not found on window, create a new instance from the module
            const JSZipConstructor = module.default || module;
            jsZip = JSZipConstructor;
            resolve(jsZip);
          }
        })
        .catch(error => {
          console.error("Error importing JSZip:", error);
          URL.revokeObjectURL(blobUrl);
          reject(error);
        });
    });
  } catch (error) {
    console.error("Failed to load JSZip:", error);
    throw error;
  }
}

// Alternative function to use built-in ZIP capabilities if JSZip fails
async function downloadWithoutJSZip(fileUrls, fileNames, zipName) {
  // Create a temporary download link
  const downloadLink = document.createElement('a');
  downloadLink.style.display = 'none';
  document.body.appendChild(downloadLink);
  
  try {
    // Download each file individually since we can't create a ZIP
    for (let i = 0; i < fileUrls.length; i++) {
      const response = await fetch(fileUrls[i]);
      if (!response.ok) {
        continue; // Skip failed downloads
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      downloadLink.href = url;
      downloadLink.download = fileNames[i];
      downloadLink.click();
      
      URL.revokeObjectURL(url);
    }
    
    return true;
  } catch (error) {
    console.error("Error downloading files:", error);
    return false;
  } finally {
    document.body.removeChild(downloadLink);
  }
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

// Function to download the current subdirectory
async function downloadSubdirectory() {
  try {
    console.log("Starting download subdirectory process");
    
    // Show progress immediately
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: "Starting download process...",
    });
    
    // Get current path information
    const currentPath = window.location.pathname;
    const pathParts = currentPath.split("/");
    console.log("Current path:", currentPath);

    // Validate that we're on a valid GitHub repository page
    if (pathParts.length < 5 || !pathParts.includes("tree")) {
      throw new Error("Not on a valid GitHub repository subdirectory page");
    }

    // Get owner, repo, branch, and directory
    const owner = pathParts[1];
    const repo = pathParts[2];
    const branchIndex = pathParts.indexOf("tree") + 1;
    const branch = pathParts[branchIndex];
    
    // Get the directory path (everything after the branch)
    const directory = pathParts.slice(branchIndex + 1).join("/");
    const directoryName = directory.split("/").pop() || repo;

    console.log(`Owner: ${owner}, Repo: ${repo}, Branch: ${branch}, Directory: ${directory}`);

    // Send initial progress update
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: "Finding files...",
    });

    // Find all files in the current directory
    const files = [];
    
    // Use document.querySelector to get file rows
    const fileRows = document.querySelectorAll('div[role="row"]');
    console.log(`Found ${fileRows.length} file rows`);
    
    if (fileRows.length === 0) {
      // Try alternative selectors if the modern ones don't work
      const alternativeRows = document.querySelectorAll('.js-navigation-item');
      console.log(`Found ${alternativeRows.length} alternative rows`);
      
      if (alternativeRows.length > 0) {
        alternativeRows.forEach(row => {
          if (row.querySelector('.up-tree')) return; // Skip parent directory
          
          const nameEl = row.querySelector('.js-navigation-open');
          if (nameEl) {
            const fileName = nameEl.textContent.trim();
            const isDirectory = nameEl.getAttribute('href').includes('/tree/');
            files.push({ name: fileName, isDirectory });
            console.log(`Found file: ${fileName}, isDirectory: ${isDirectory}`);
          }
        });
      }
    } else {
      // Process modern GitHub UI rows
      fileRows.forEach(row => {
        // Skip header row and parent directory
        if (row.getAttribute('aria-labelledby') === 'files' || row.querySelector('[aria-label="parent directory"]')) return;
        
        // Get name from the row
        const nameEl = row.querySelector('a[role="rowheader"] span');
        if (nameEl) {
          const fileName = nameEl.textContent.trim();
          // Check if it's a directory by looking at the icon
          const svgIcon = row.querySelector('svg[aria-label="Directory"], svg[aria-label="File"]');
          const isDirectory = svgIcon && svgIcon.getAttribute('aria-label') === 'Directory';
          
          files.push({ name: fileName, isDirectory });
          console.log(`Found file: ${fileName}, isDirectory: ${isDirectory}`);
        }
      });
    }
    
    // If no files were found with the above methods, try one more method
    if (files.length === 0) {
      const fileLinks = document.querySelectorAll('a[href*="blob/"], a[href*="tree/"]');
      console.log(`Found ${fileLinks.length} file links`);
      
      if (fileLinks.length > 0) {
        fileLinks.forEach(link => {
          const fileName = link.textContent.trim();
          const isDirectory = link.getAttribute('href').includes('/tree/');
          
          // Skip links that aren't actually files (like "Go to file" buttons)
          if (fileName && !fileName.includes('Go to') && !fileName.includes('github.com')) {
            files.push({ name: fileName, isDirectory });
            console.log(`Found file: ${fileName}, isDirectory: ${isDirectory}`);
          }
        });
      }
    }
    
    if (files.length === 0) {
      throw new Error("No files found in this directory. Try refreshing the page.");
    }

    // Process files to add full paths
    const processedFiles = files.map(file => ({
      ...file,
      fullPath: directory ? `${directory}/${file.name}` : file.name
    }));
    
    // Filter out directories if needed
    const filesToDownload = processedFiles.filter(file => !file.isDirectory);
    
    if (filesToDownload.length === 0) {
      throw new Error("No files found to download - only directories were found");
    }

    // Update progress
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: `Found ${filesToDownload.length} files to download...`,
    });

    // Try to load JSZip library
    let JSZipClass = null;
    try {
      JSZipClass = await loadJSZip();
      console.log("JSZip loaded successfully:", typeof JSZipClass);
    } catch (error) {
      console.error("Error loading JSZip:", error);
      
      // If JSZip fails to load, we'll download files individually
      chrome.runtime.sendMessage({
        action: "updateProgress",
        message: "ZIP creation not available. Downloading files individually...",
      });
      
      // Prepare file URLs and names
      const fileUrls = filesToDownload.map(file => 
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.fullPath}`
      );
      const fileNames = filesToDownload.map(file => file.name);
      
      // Download files individually
      const success = await downloadWithoutJSZip(fileUrls, fileNames, directoryName);
      
      if (success) {
        chrome.runtime.sendMessage({
          action: "downloadComplete",
          message: `Downloaded ${filesToDownload.length} files individually.`,
        });
        return { success: true, individual: true };
      } else {
        throw new Error("Failed to download files. Please try again.");
      }
    }
    
    console.log("Creating new JSZip instance");
    const zip = new JSZipClass();
    const rootFolder = zip.folder(directoryName);
    if (!rootFolder) {
      throw new Error("Failed to create folder in ZIP file");
    }
    
    // Function to download a single file
    async function downloadFile(file) {
      try {
        console.log(`Downloading: ${file.fullPath}`);
        
        // Try the first URL format
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.fullPath}`;
        console.log("URL:", rawUrl);
        
        let response = await fetch(rawUrl, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Accept': '*/*'
          }
        });
        
        // If that fails, try the alternate URL
        if (!response.ok) {
          console.log(`First download attempt failed with status ${response.status}, trying alternate URL`);
          
          const alternateUrl = `https://github.com/${owner}/${repo}/raw/${branch}/${file.fullPath}`;
          console.log("Alternate URL:", alternateUrl);
          
          response = await fetch(alternateUrl, {
            method: 'GET',
            cache: 'no-store'
          });
          
          if (!response.ok) {
            throw new Error(`Failed to download ${file.name}: Status ${response.status}`);
          }
        }
        
        // Get the file content as an array buffer
        const content = await response.arrayBuffer();
        console.log(`Downloaded ${file.name}, size: ${content.byteLength} bytes`);
        
        // Add file to the zip
        rootFolder.file(file.name, content);
        return true;
      } catch (error) {
        console.error(`Error downloading ${file.name}:`, error);
        return false;
      }
    }
    
    // Download all files sequentially
    let completed = 0;
    let failed = 0;
    
    for (let i = 0; i < filesToDownload.length; i++) {
      const file = filesToDownload[i];
      
      // Update progress
      chrome.runtime.sendMessage({
        action: "updateProgress",
        message: `Downloading file ${i+1} of ${filesToDownload.length}: ${file.name}`,
      });
      
      // Download the file
      const success = await downloadFile(file);
      
      if (success) {
        completed++;
      } else {
        failed++;
      }
      
      // Update progress percentage
      chrome.runtime.sendMessage({
        action: "updateProgress",
        message: `Downloaded ${completed} of ${filesToDownload.length} files (${failed} failed)`,
      });
    }
    
    if (completed === 0) {
      throw new Error("Failed to download any files. Check console for error details.");
    }
    
    // Generate the zip file
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: "Creating ZIP file...",
    });
    
    console.log("Generating ZIP...");
    
    // Keep track of ZIP generation progress
    const zipOptions = {
      type: "blob",
      compression: "DEFLATE",
      streamFiles: true
    };
    
    const zipBlob = await zip.generateAsync(zipOptions, metadata => {
      // Update progress every 10%
      if (metadata.percent % 10 === 0) {
        chrome.runtime.sendMessage({
          action: "updateProgress",
          message: `Creating ZIP file: ${Math.round(metadata.percent)}% complete...`,
        });
      }
    });
    
    console.log("ZIP generated, size:", zipBlob.size, "bytes");
    
    // Download the zip file
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${directoryName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log("Download triggered");

    // Send completion message
    chrome.runtime.sendMessage({
      action: "downloadComplete",
      message: `Download complete! ${completed} files downloaded${failed > 0 ? `, ${failed} files failed` : ''}`,
    });

    return { success: true, filesDownloaded: completed, filesFailed: failed };
  } catch (error) {
    console.error("Download error:", error);
    chrome.runtime.sendMessage({
      action: "downloadError",
      message: error.message || "An unknown error occurred",
    });
    throw error;
  }
}

// Notify that the content script is loaded
console.log("GitHub Repo Downloader content script loaded");
