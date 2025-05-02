# GitHub Repository Downloader

A Chrome extension that allows you to download GitHub repositories or specific subdirectories as ZIP files directly from your browser.

## Features

- Download entire GitHub repositories with one click
- Download specific subdirectories without having to clone the entire repository
- Simple and intuitive user interface
- Works directly from GitHub pages

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the extension directory
5. The extension icon should now appear in your browser toolbar

## Usage

1. Navigate to any GitHub repository or subdirectory
2. Click the extension icon in your browser toolbar
3. Click the "Download Repository" button
4. For full repositories, the download will begin immediately
5. For subdirectories, the extension will gather all files and create a ZIP archive

## How It Works

- For full repositories: Uses GitHub's built-in ZIP download functionality
- For subdirectories: Scans the page to identify files, downloads them individually, and packages them into a ZIP file using JSZip

## Requirements

- Chrome browser
- Internet connection
- Access to GitHub.com

## Credits

This extension uses [JSZip](https://stuk.github.io/jszip/) to create ZIP files.

