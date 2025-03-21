// Function to check if the current page is a GitHub repository directory
function isRepoDirectory() {
  const pathSegments = window.location.pathname.split("/");
  return pathSegments.length >= 4 && pathSegments[3] === "tree"; // Checks for 'tree' in the URL
}

// Function to construct the download URL for the current directory
function constructDownloadURL() {
  return `https://download-directory.github.io/?url=${window.location.href}`;
}

// Function to insert the download button
function insertDownloadButton() {
  if (!isRepoDirectory()) return; // Only add the button on repository tree pages

  if (document.querySelector("#download-directory-button")) return; // Prevent duplicates

  const container = document.querySelector(".file-navigation");
  if (!container) return; // Ensure the container exists

  const button = document.createElement("a");
  button.id = "download-directory-button";
  button.innerText = "Download Directory";
  button.href = constructDownloadURL();
  button.className = "btn btn-primary";
  button.style.marginLeft = "10px";

  container.appendChild(button); // Add button to the file navigation bar
}

// Run the function on window load
window.addEventListener("load", insertDownloadButton);

// Use MutationObserver to handle dynamic content loading (for GitHub pages)
const observer = new MutationObserver(insertDownloadButton);
observer.observe(document.body, { childList: true, subtree: true });
