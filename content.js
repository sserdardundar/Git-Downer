function isGitHubRepo() {
  return document.location.pathname.split("/").length >= 3;
}

function insertDownloadButton() {
  if (!isGitHubRepo()) return;

  if (document.querySelector("#download-repo-button")) return;

  const actionsBar = document.querySelector(".file-navigation");
  if (!actionsBar) return;

  let button = document.createElement("a");
  button.id = "download-repo-button";
  button.innerText = "Download Repo";
  button.href = `https://download-directory.github.io/${document.location.pathname}`;
  button.target = "_blank";
  button.className = "btn btn-primary";

  actionsBar.appendChild(button);
}

window.onload = insertDownloadButton;
