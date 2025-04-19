# 🧹 GitHub Downloader Extension

A simple and lightweight Chrome extension that adds a **Download ZIP** button to any GitHub repository page, making it easy to download the entire repository without opening extra menus or navigating through the GitHub interface.

## 🚀 Features

- 📦 One-click download of GitHub repositories as ZIP files  
- 🧱 Automatically detects and appears on GitHub repository pages  
- 💡 Clean, minimal UI with seamless GitHub integration  

## 🛠️ Installation

### Option 1: Load as an unpacked extension (recommended for development)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/sserdardundar/Git-Downer.git
   ```
2. Open Chrome and go to `chrome://extensions/`  
3. Enable **Developer mode** (toggle in the top right)  
4. Click **Load unpacked** and select the folder containing this project  

### Option 2: Download as ZIP and load manually

1. Download the ZIP of this repository  
2. Extract it anywhere on your computer  
3. Go to `chrome://extensions/` in Chrome  
4. Enable **Developer mode**  
5. Click **Load unpacked** and select the extracted folder  

## 🧪 How It Works

The extension injects a content script into GitHub repository pages. When it detects a valid repository, it dynamically adds a button to extension popup(!!for now) that triggers a download of the main/subrepository's ZIP file.


## ⚙️ Permissions

- `https://github.com/*`: Access to GitHub pages to inject the button  

## 📌 Known Limitations

- Only works on public GitHub repositories  


## 📄 License

This project is licensed under the [MIT License](LICENSE).

