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

    // Try to load JSZip library
    let JSZipClass = null;
    try {
      JSZipClass = await loadJSZip();
      console.log("JSZip loaded successfully:", typeof JSZipClass);
    } catch (error) {
      console.error("Error loading JSZip:", error);
      throw new Error("Failed to load JSZip library. Please try again.");
    }
    
    console.log("Creating new JSZip instance");
    const zip = new JSZipClass();
    const rootFolder = zip.folder(directoryName);
    if (!rootFolder) {
      throw new Error("Failed to create folder in ZIP file");
    }

    // Process repo information for recursive functions
    const repoInfo = { owner, repo, branch };

    // Keep track of overall progress
    let totalFiles = 0;
    let processedItems = 0;
    let completedFiles = 0;
    let failedFiles = 0;
    
    // Function to get the content type from a URL
    function getContentTypeFromUrl(url) {
      if (url.includes('/tree/')) {
        return 'dir';
      } else if (url.includes('/blob/')) {
        return 'file';
      }
      return 'unknown';
    }
    
    // Function to convert a GitHub file URL to a raw content URL
    function convertToRawUrl(url) {
      return url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }
    
    // Function to get a correct API URL for a directory listing
    function getDirectoryApiUrl(path, repoInfo) {
      return `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${path}?ref=${repoInfo.branch}`;
    }
    
    // Main recursive directory processing function
    async function processDirectoryRecursively(dirPath, zipFolder) {
      console.log(`Processing directory: ${dirPath}`);
      
      chrome.runtime.sendMessage({
        action: "updateProgress",
        message: `Processing directory: ${dirPath || 'root'}`
      });
      
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
          if (!dirPath || dirPath === directory) {
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
        for (const item of contents) {
          processedItems++;
          console.log(`Processing ${item.type}: ${item.path} (${processedItems}/${contents.length})`);
          
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
            await processDirectoryRecursively(subDirPath, subFolder);
          } else if (item.type === 'file') {
            // Download and add file to ZIP
            totalFiles++;
            
            chrome.runtime.sendMessage({
              action: "updateProgress",
              message: `Downloading: ${item.name} (${completedFiles + 1} of ${totalFiles})`
            });
            
            try {
              const success = await downloadAndAddFile(item, zipFolder);
              if (success) {
                completedFiles++;
              } else {
                failedFiles++;
              }
            } catch (error) {
              console.error(`Error downloading file ${item.name}:`, error);
              failedFiles++;
            }
          }
        }
        
        return contents.length;
      } catch (error) {
        console.error(`Error processing directory ${dirPath}:`, error);
        // Fall back to HTML scraping if API fails
        if (!dirPath || dirPath === directory) {
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
        processedItems++;
        
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
            await processDirectoryFromUrl(entry.url, subDirPath, subFolder);
            processedCount++;
          } catch (error) {
            console.error(`Error processing subdirectory ${subDirPath}:`, error);
          }
        } else {
          // Add file to ZIP
          totalFiles++;
          processedCount++;
          
          chrome.runtime.sendMessage({
            action: "updateProgress",
            message: `Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`
          });
          
          try {
            const fileItem = {
              name: entry.name,
              path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
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
            
            chrome.runtime.sendMessage({
              action: "updateProgress",
              message: `Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`
            });
            
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
    
    // Function to download and add a file to the ZIP
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

    // Send initial progress update
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: "Finding files and directories...",
    });
    
    // Start the recursive directory processing
    await processDirectoryRecursively(directory, rootFolder);
    
    // Check if we found and processed any files
    if (totalFiles === 0) {
      throw new Error("No files found to download. Please check console for details.");
    }
    
    // Generate the zip file
    chrome.runtime.sendMessage({
      action: "updateProgress",
      message: `Creating ZIP file with ${completedFiles} files...`,
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
      message: `Download complete! ${completedFiles} files downloaded${failedFiles > 0 ? `, ${failedFiles} files failed` : ''}`,
    });

    return { 
      success: true, 
      totalFiles,
      filesDownloaded: completedFiles, 
      filesFailed: failedFiles 
    };
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
