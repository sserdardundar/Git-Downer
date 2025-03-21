function isRepoDirectory() {
  const pathSegments = window.location.pathname.split("/");
  return pathSegments.length >= 4 && pathSegments[3] === "tree";
}

function constructDownloadURL() {
  const repoURL = window.location.href;
  return `https://download-directory.github.io/?url=${repoURL}`;
}

function insertDownloadButton() {
  if (!isRepoDirectory()) return;

  if (document.querySelector("#download-directory-button")) return;

  const container = document.querySelector(".file-navigation");
  if (!container) return;

  const button = document.createElement("a");
  button.id = "download-directory-button";
  button.innerText = "Download Directory";
  button.href = "#";
  button.className = "btn btn-primary";

  button.addEventListener("click", (event) => {
    event.preventDefault();
    const downloadURL = constructDownloadURL();
    fetch(downloadURL)
      .then((response) => {
        if (response.ok) {
          const tempLink = document.createElement("a");
          tempLink.href = downloadURL;
          tempLink.download = "";
          document.body.appendChild(tempLink);
          tempLink.click();
          document.body.removeChild(tempLink);
        } else {
          console.error("Failed to initiate download.");
        }
      })
      .catch((error) => console.error("Error:", error));
  });

  container.appendChild(button);
}

window.addEventListener("load", insertDownloadButton);
