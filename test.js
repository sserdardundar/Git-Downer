/**
 * GitHub Repo Downloader - Test Script
 * 
 * This script checks if all required files are present and accessible.
 * Run it with Node.js to verify your extension setup.
 */

const fs = require('fs');
const path = require('path');

// Required files for the extension
const requiredFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'contentScript.js',
  'background.js',
  'jszip.min.js',
  'icon.png',
  'gitdown.png'
];

// Optional files
const optionalFiles = [
  'README.md',
  'LICENSE'
];

console.log('GitHub Repo Downloader - Installation Test\n');

// Check if all required files are present
console.log('Checking required files:');
let allRequiredPresent = true;

requiredFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`- ${file}: ${exists ? '✅ Present' : '❌ Missing'}`);
  if (!exists) {
    allRequiredPresent = false;
  }
});

console.log('\nChecking optional files:');
optionalFiles.forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`- ${file}: ${exists ? '✅ Present' : '⚠️ Not found'}`);
});

console.log('\nVerifying manifest.json permissions:');
try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  
  // Check permissions
  const requiredPermissions = [
    'activeTab', 
    'https://github.com/*', 
    'https://raw.githubusercontent.com/*'
  ];
  
  const hasAllPermissions = requiredPermissions.every(perm => 
    manifest.permissions && manifest.permissions.includes(perm)
  );
  
  console.log(`- Required permissions: ${hasAllPermissions ? '✅ Present' : '⚠️ Incomplete'}`);
  
  // Check content scripts
  const hasContentScripts = manifest.content_scripts && 
    manifest.content_scripts.some(cs => 
      cs.matches && cs.matches.includes('*://github.com/*') && 
      cs.js && cs.js.includes('contentScript.js')
    );
  
  console.log(`- Content script configuration: ${hasContentScripts ? '✅ Valid' : '⚠️ Issues detected'}`);
  
  // Check web accessible resources
  const hasJSZip = manifest.web_accessible_resources && 
    manifest.web_accessible_resources.includes('jszip.min.js');
  
  console.log(`- JSZip accessibility: ${hasJSZip ? '✅ Properly configured' : '⚠️ Not properly configured'}`);
  
} catch (error) {
  console.error('❌ Error parsing manifest.json:', error.message);
  allRequiredPresent = false;
}

// Overall status
console.log('\nTest Results:');
if (allRequiredPresent) {
  console.log('✅ All required files are present. The extension should work correctly.');
  console.log('Installation steps:');
  console.log('1. Open Chrome and go to chrome://extensions/');
  console.log('2. Enable "Developer mode" (toggle in the top right)');
  console.log('3. Click "Load unpacked" and select this directory');
} else {
  console.log('❌ Some required files are missing. The extension may not work correctly.');
  console.log('Please ensure all required files are present before loading the extension.');
}

console.log('\nFor support or to report issues, please refer to the README.md file.'); 