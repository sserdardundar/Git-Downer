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

// Function to add download button to GitHub UI
function addDownloadButtonToUI() {
  // Check if we're on a GitHub repository page
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length < 3) {
    return; // Not a repository page
  }
  
  const isRepoPage = pathParts.length >= 3 && 
                     !['settings', 'search', 'marketplace', 'explore'].includes(pathParts[1]);
  
  if (!isRepoPage) {
    return;
  }
  
  console.log("Adding download button to GitHub UI");
  
  // Find the repository navigation bar
  const navBar = document.querySelector('nav[aria-label="Repository"], .pagehead-actions, ul.UnderlineNav-body');
  if (!navBar) {
    console.log("Repository navigation bar not found");
    return;
  }
  
  // Check if button already exists
  if (document.getElementById('github-repo-downloader-btn')) {
    return;
  }
  
  // Create the download button
  const downloadButton = document.createElement('li');
  downloadButton.className = 'UnderlineNav-item d-flex';
  downloadButton.id = 'github-repo-downloader-btn';
  downloadButton.style.marginLeft = '8px';
  
  const isTreeView = window.location.pathname.includes('/tree/');
  const buttonText = isTreeView ? 'Download Directory' : 'Download Repository';
  
  // Modern GitHub UI (2023+)
  if (navBar.classList.contains('UnderlineNav-body')) {
    downloadButton.innerHTML = `
      <a class="UnderlineNav-item" role="tab" data-view-component="true" aria-current="page">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="margin-right: 4px;">
          <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
        </svg>
        <span data-content="${buttonText}">${buttonText}</span>
      </a>
    `;
    
    // Add green styling
    const navLink = downloadButton.querySelector('a');
    navLink.style.color = '#2ea44f';
    navLink.style.fontWeight = '600';
    
    // Add hover effect
    navLink.addEventListener('mouseover', () => {
      navLink.style.backgroundColor = 'rgba(46, 164, 79, 0.1)';
    });
    navLink.addEventListener('mouseout', () => {
      navLink.style.backgroundColor = '';
    });
    
    navBar.appendChild(downloadButton);
  } 
  // Legacy GitHub UI
  else {
    // Create button for older GitHub UI
    downloadButton.innerHTML = `
      <a class="btn btn-sm btn-primary" style="background-color: #2ea44f; border-color: #2ea44f;">
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-download mr-1">
          <path d="M8 2c-.55 0-1 .45-1 1v5H2c-.55 0-1 .45-1 1 0 .25.1.5.29.7l6 6c.2.19.45.3.71.3.26 0 .51-.1.71-.29l6-6c.19-.2.29-.45.29-.7 0-.56-.45-1-1-1H9V3c0-.55-.45-1-1-1Z"></path>
        </svg>
        ${buttonText}
      </a>
    `;
    
    if (navBar.classList.contains('pagehead-actions')) {
      navBar.insertBefore(downloadButton, navBar.firstChild);
    } else {
      navBar.appendChild(downloadButton);
    }
  }
  
  // Add click event listener to the button
  const buttonElement = downloadButton.querySelector('a');
  buttonElement.addEventListener('click', (event) => {
    event.preventDefault();
    console.log("Download button clicked");
    downloadSubdirectory().catch(error => {
      console.error("Download error:", error);
      alert(`Download error: ${error.message}`);
    });
  });
  
  console.log("Download button added to GitHub UI");
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
    }).catch(error => console.warn("Message sending error:", error));
    
    // Get current path information
    const currentPath = window.location.pathname;
    const pathParts = currentPath.split("/");
    console.log("Current path:", currentPath);

    // Validate that we're on a valid GitHub repository page
    if (pathParts.length < 3) {
      throw new Error("Not on a valid GitHub repository page");
    }

    // Get owner, repo, branch, and directory
    const owner = pathParts[1];
    const repo = pathParts[2];
    
    // Handle both repository root and subdirectory cases
    let branch = 'main';
    let directory = '';
    let directoryName = repo;
    
    // Check if we're on a tree view (subdirectory)
    const isTreeView = pathParts.includes("tree");
    if (isTreeView) {
      const branchIndex = pathParts.indexOf("tree") + 1;
      if (branchIndex < pathParts.length) {
        branch = pathParts[branchIndex];
        directory = pathParts.slice(branchIndex + 1).join("/");
        directoryName = directory.split("/").pop() || repo;
      }
    } else {
      // For repo root, try to determine the default branch
      try {
        const apiResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (apiResponse.ok) {
          const repoData = await apiResponse.json();
          branch = repoData.default_branch;
        }
      } catch (error) {
        console.error("Error determining default branch:", error);
        // Fall back to 'main' if we can't determine the default branch
      }
    }

    console.log(`Owner: ${owner}, Repo: ${repo}, Branch: ${branch}, Directory: ${directory}`);

    // Check for GitHub's built-in download option first
    try {
      // Look for the "Download ZIP" button that GitHub provides
      const downloadBtn = document.querySelector('a[data-testid="download-raw-button"], a[data-turbo-frame="archive-fragment"]');
      
      if (downloadBtn) {
        console.log("GitHub's native download button found:", downloadBtn);
        
        chrome.runtime.sendMessage({
          action: "updateProgress",
          message: "Using GitHub's native download option...",
        }).catch(error => console.warn("Message sending error:", error));
        
        // Click the download button to trigger GitHub's native download
        downloadBtn.click();
        
        // Wait a bit and send completion message
        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: "downloadComplete",
            message: "Download initiated using GitHub's native download feature!",
          }).catch(error => console.warn("Message sending error:", error));
        }, 2000);
        
        return { 
          success: true, 
          method: "github_native" 
        };
      }
      
      console.log("No GitHub native download button found, proceeding with custom download method");
    } catch (error) {
      console.error("Error checking for GitHub's download button:", error);
      // Continue with our custom download method
    }

    // Try to load JSZip library with improved error handling
    let JSZipClass = null;
    try {
      JSZipClass = await loadJSZip();
      console.log("JSZip loaded successfully:", typeof JSZipClass);
    } catch (error) {
      console.error("Error loading JSZip:", error);
      
      // Try loading JSZip again with a different method
      try {
        console.log("Attempting alternative JSZip loading method...");
        // Try to directly import JSZip from CDN if extension load fails
        JSZipClass = await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          script.onload = () => {
            if (window.JSZip) {
              resolve(window.JSZip);
            } else {
              reject(new Error("JSZip not found after loading from CDN"));
            }
          };
          script.onerror = () => reject(new Error("Failed to load JSZip from CDN"));
          document.body.appendChild(script);
        });
        console.log("JSZip loaded from CDN successfully:", typeof JSZipClass);
      } catch (cdnError) {
        console.error("All JSZip loading methods failed:", cdnError);
        throw new Error("Could not load ZIP library. Please try reloading the page or reinstalling the extension.");
      }
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
    
    // Function to get archive download URL directly from GitHub
    function getArchiveUrl(repoInfo, path = '') {
      // For the root repository
      if (!path) {
        return `https://github.com/${repoInfo.owner}/${repoInfo.repo}/archive/refs/heads/${repoInfo.branch}.zip`;
      }
      
      // For a subdirectory - use GitHub's SVN export (this is a technique used by tools like DownGit)
      return `https://github.com/${repoInfo.owner}/${repoInfo.repo}/trunk/${path}`;
    }
    
    // Try to download the directory directly using GitHub's archive feature
    async function tryDirectDownload() {
      try {
        chrome.runtime.sendMessage({
          action: "updateProgress",
          message: "Attempting direct download from GitHub...",
        }).catch(error => console.warn("Message sending error:", error));
        
        const archiveUrl = getArchiveUrl(repoInfo, directory);
        console.log(`Trying direct download from: ${archiveUrl}`);
        
        // Create a download link and trigger it
        const a = document.createElement('a');
        a.href = archiveUrl;
        a.download = `${directoryName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        chrome.runtime.sendMessage({
          action: "downloadComplete",
          message: "Direct download initiated from GitHub!",
        }).catch(error => console.warn("Message sending error:", error));
        
        return true;
      } catch (error) {
        console.error("Direct download failed:", error);
        return false;
      }
    }
    
    // Try direct download first
    const directSuccess = await tryDirectDownload();
    if (directSuccess) {
      return { 
        success: true, 
        method: "direct_download" 
      };
    }
    
    // If direct download fails, fall back to the recursive method
    console.log("Direct download failed or not available, falling back to recursive method");
    
    // Send a progress update with safer message sending (catches errors)
    function sendProgressUpdate(message) {
      chrome.runtime.sendMessage({
        action: "updateProgress",
        message: message,
      }).catch(error => console.warn("Message sending error:", error));
    }
    
    // Main recursive directory processing function with safer message sending
    async function processDirectoryRecursively(dirPath, zipFolder) {
      console.log(`Processing directory: ${dirPath}`);
      
      sendProgressUpdate(`Processing directory: ${dirPath || 'root'}`);
      
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
            
            sendProgressUpdate(`Downloading: ${item.name} (${completedFiles + 1} of ${totalFiles})`);
            
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
          
          sendProgressUpdate(`Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`);
          
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
            
            sendProgressUpdate(`Downloading: ${entry.name} (${completedFiles + 1} of ${totalFiles})`);
            
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
    sendProgressUpdate("Finding files and directories...");
    
    // Start the recursive directory processing
    await processDirectoryRecursively(directory, rootFolder);
    
    // Check if we found and processed any files
    if (totalFiles === 0) {
      throw new Error("No files found to download. Please check console for details.");
    }
    
    // Generate the zip file
    sendProgressUpdate(`Creating ZIP file with ${completedFiles} files...`);
    
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
        sendProgressUpdate(`Creating ZIP file: ${Math.round(metadata.percent)}% complete...`);
      }
    });
    
    console.log("ZIP generated, size:", zipBlob.size, "bytes");
    
    // Download the zip file with error handling
    try {
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${directoryName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log("Download triggered");

      // Send completion message with error handling
      chrome.runtime.sendMessage({
        action: "downloadComplete",
        message: `Download complete! ${completedFiles} files downloaded${failedFiles > 0 ? `, ${failedFiles} files failed` : ''}`,
      }).catch(error => console.warn("Message sending error:", error));
    } catch (error) {
      console.error("Error initiating download:", error);
      throw new Error("Failed to download the ZIP file. Try again or check browser settings.");
    }

    return { 
      success: true, 
      totalFiles,
      filesDownloaded: completedFiles, 
      filesFailed: failedFiles 
    };
  } catch (error) {
    console.error("Download error:", error);
    
    // Send error message with safer approach
    try {
      chrome.runtime.sendMessage({
        action: "downloadError",
        message: error.message || "An unknown error occurred",
      }).catch(e => console.warn("Failed to send error message:", e));
    } catch (msgError) {
      console.error("Failed to send error via Chrome runtime:", msgError);
    }
    
    throw error;
  }
}

// Function to observe DOM changes and add the download button when navigation happens
function setupMutationObserver() {
  // Add download button on initial page load
  addDownloadButtonToUI();

  // Create a mutation observer to watch for navigation changes
  const observer = new MutationObserver((mutations) => {
    const navChanged = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.querySelector && (
            node.querySelector('nav[aria-label="Repository"]') ||
            node.querySelector('.UnderlineNav-body') ||
            node.classList.contains('pagehead-actions')
          );
        }
        return false;
      });
    });

    if (navChanged) {
      addDownloadButtonToUI();
    }
  });

  // Start observing the document with the configured parameters
  observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMutationObserver);
} else {
  setupMutationObserver();
}

// Notify that the content script is loaded
console.log("GitHub Repo Downloader content script loaded");
