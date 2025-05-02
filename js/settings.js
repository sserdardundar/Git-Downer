// Settings script for GitHub Repository Downloader

// Default settings
const defaultSettings = {
  buttonColor: '#2ea44f',      // GitHub green
  popupBgColor: '#f6f8fa',     // GitHub light gray
  buttonText: 'Download Repository',
  buttonStyle: 'default'       // default, outline, rounded, pill
};

// Initialize settings
document.addEventListener('DOMContentLoaded', function() {
  const buttonColorInput = document.getElementById('buttonColor');
  const buttonColorPreview = document.getElementById('buttonColorPreview');
  const popupBgColorInput = document.getElementById('popupBgColor');
  const popupBgPreview = document.getElementById('popupBgPreview');
  const buttonTextInput = document.getElementById('buttonText');
  const buttonStyleSelect = document.getElementById('buttonStyle');
  const saveButton = document.getElementById('saveSettings');
  const resetButton = document.getElementById('resetSettings');
  const messageDiv = document.getElementById('message');
  
  // Preview elements
  const previewPopup = document.getElementById('previewPopup');
  const previewButton = document.getElementById('previewButton');
  
  // Get preset buttons
  const presetButtonColors = document.querySelectorAll('.preset-button[data-color]');
  
  // Load current settings
  chrome.storage.sync.get(defaultSettings, (settings) => {
    // Populate the form with current settings
    buttonColorInput.value = settings.buttonColor;
    buttonColorPreview.style.backgroundColor = settings.buttonColor;
    popupBgColorInput.value = settings.popupBgColor;
    popupBgPreview.style.backgroundColor = settings.popupBgColor;
    buttonTextInput.value = settings.buttonText;
    buttonStyleSelect.value = settings.buttonStyle;
    
    // Update preview
    updatePreview(settings);
  });
  
  // Handle color input changes
  buttonColorInput.addEventListener('input', function() {
    buttonColorPreview.style.backgroundColor = this.value;
    updatePreview();
  });
  
  popupBgColorInput.addEventListener('input', function() {
    popupBgPreview.style.backgroundColor = this.value;
    updatePreview();
  });
  
  // Handle text input changes
  buttonTextInput.addEventListener('input', function() {
    updatePreview();
  });
  
  // Handle style selection changes
  buttonStyleSelect.addEventListener('change', function() {
    updatePreview();
  });
  
  // Handle preset button clicks
  presetButtonColors.forEach(button => {
    button.addEventListener('click', function() {
      const color = this.getAttribute('data-color');
      // Find which color picker is closest to this preset button
      const parentGroup = this.closest('.form-group');
      if (parentGroup.contains(buttonColorInput)) {
        buttonColorInput.value = color;
        buttonColorPreview.style.backgroundColor = color;
      } else if (parentGroup.contains(popupBgColorInput)) {
        popupBgColorInput.value = color;
        popupBgPreview.style.backgroundColor = color;
      }
      updatePreview();
    });
  });
  
  // Save settings
  saveButton.addEventListener('click', function() {
    const settings = {
      buttonColor: buttonColorInput.value,
      popupBgColor: popupBgColorInput.value,
      buttonText: buttonTextInput.value,
      buttonStyle: buttonStyleSelect.value
    };
    
    chrome.storage.sync.set(settings, function() {
      showMessage('Settings saved successfully!', 'success');
    });
  });
  
  // Reset settings
  resetButton.addEventListener('click', function() {
    if (confirm('Reset all settings to default values?')) {
      chrome.storage.sync.set(defaultSettings, function() {
        // Update form values
        buttonColorInput.value = defaultSettings.buttonColor;
        buttonColorPreview.style.backgroundColor = defaultSettings.buttonColor;
        popupBgColorInput.value = defaultSettings.popupBgColor;
        popupBgPreview.style.backgroundColor = defaultSettings.popupBgColor;
        buttonTextInput.value = defaultSettings.buttonText;
        buttonStyleSelect.value = defaultSettings.buttonStyle;
        
        // Update preview
        updatePreview(defaultSettings);
        
        showMessage('Settings reset to defaults', 'success');
      });
    }
  });
  
  // Helper function to update preview
  function updatePreview(settings) {
    // Use settings if provided, otherwise use form values
    const btnColor = settings ? settings.buttonColor : buttonColorInput.value;
    const bgColor = settings ? settings.popupBgColor : popupBgColorInput.value;
    const btnText = settings ? settings.buttonText : buttonTextInput.value;
    const btnStyle = settings ? settings.buttonStyle : buttonStyleSelect.value;
    
    // Update preview popup
    previewPopup.style.backgroundColor = bgColor;
    
    // Update preview button
    previewButton.textContent = btnText;
    
    // Apply button style based on selection
    switch(btnStyle) {
      case 'outline':
        previewButton.style.backgroundColor = 'transparent';
        previewButton.style.color = btnColor;
        previewButton.style.border = `1px solid ${btnColor}`;
        previewButton.style.borderRadius = '6px';
        break;
      case 'rounded':
        previewButton.style.backgroundColor = btnColor;
        previewButton.style.color = '#ffffff';
        previewButton.style.border = 'none';
        previewButton.style.borderRadius = '10px';
        break;
      case 'pill':
        previewButton.style.backgroundColor = btnColor;
        previewButton.style.color = '#ffffff';
        previewButton.style.border = 'none';
        previewButton.style.borderRadius = '20px';
        break;
      default: // default style
        previewButton.style.backgroundColor = btnColor;
        previewButton.style.color = '#ffffff';
        previewButton.style.border = 'none';
        previewButton.style.borderRadius = '6px';
    }
    
    // Check if background is dark and apply contrast text for preview
    const bgBrightness = getColorBrightness(bgColor);
    if (bgBrightness < 128) {
      previewPopup.style.color = '#f0f6fc';
    } else {
      previewPopup.style.color = '#24292e';
    }
    
    // Check if button color is light and apply contrast text
    const btnBrightness = getColorBrightness(btnColor);
    if (btnStyle === 'outline') {
      // For outline style, button text color is the button color
    } else if (btnBrightness > 170) {
      previewButton.style.color = '#24292e';
    }
  }
  
  // Helper function to show message
  function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 3000);
  }
  
  // Helper function to calculate color brightness
  function getColorBrightness(color) {
    // For hex colors
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return (r * 299 + g * 587 + b * 114) / 1000;
    }
    
    // For rgb colors
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      return (r * 299 + g * 587 + b * 114) / 1000;
    }
    
    return 255; // Default to light
  }
}); 