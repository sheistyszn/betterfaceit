// Faceit UI Cleaner - Popup Script

// Default configuration
let config = {
  hideFeedItems: true,
  hideNavButtons: true,
  hidePartyWidget: true,
  hideNotifications: true
};

// DOM elements
const elements = {
  hideFeedItems: document.getElementById('hideFeedItems'),
  hideNavButtons: document.getElementById('hideNavButtons'),
  hidePartyWidget: document.getElementById('hidePartyWidget'),
  hideNotifications: document.getElementById('hideNotifications'),
  statusMessage: document.getElementById('statusMessage')
};

// Initialize popup
function initPopup() {
  // Get current tab
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const activeTab = tabs[0];
    // Only proceed if we're on a faceit.com page
    if (activeTab && activeTab.url && activeTab.url.includes('faceit.com')) {
      // Check if content script is loaded first
      checkContentScriptLoaded(activeTab.id, () => {
        loadConfig();
        setupEventListeners();
      });
    } else {
      showStatus('This extension only works on faceit.com', 'error');
      disableControls();
    }
  });
}

// Check if the content script is loaded in the tab
function checkContentScriptLoaded(tabId, callback) {
  if (!tabId) {
    showStatus('Error: Cannot connect to tab', 'error');
    return;
  }

  try {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, response => {
      if (chrome.runtime.lastError) {
        console.debug('Content script not ready:', chrome.runtime.lastError);
        showStatus('Content script not loaded. Please refresh the page.', 'error');
        return;
      }
      
      if (response && response.status === 'alive') {
        callback();
      } else {
        showStatus('Extension not active on this page. Try refreshing.', 'error');
      }
    });
  } catch (error) {
    console.error('Error checking content script:', error);
    showStatus('Error connecting to page. Try refreshing.', 'error');
  }
}

// Load configuration from storage
function loadConfig() {
  try {
    chrome.storage.sync.get('faceitCleanerConfig', (data) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading config:', chrome.runtime.lastError);
        showStatus('Error loading settings. Using defaults.', 'error');
        updateUI();
        return;
      }
      
      if (data.faceitCleanerConfig) {
        config = {...config, ...data.faceitCleanerConfig};
      }
      updateUI();
    });
  } catch (error) {
    console.error('Failed to load config:', error);
    showStatus('Error loading settings. Using defaults.', 'error');
    updateUI();
  }
}

// Update UI based on config
function updateUI() {
  elements.hideFeedItems.checked = config.hideFeedItems;
  elements.hideNavButtons.checked = config.hideNavButtons;
  elements.hidePartyWidget.checked = config.hidePartyWidget;
  elements.hideNotifications.checked = config.hideNotifications;
}

// Save configuration to storage
function saveConfig() {
  chrome.storage.sync.set({ faceitCleanerConfig: config }, () => {
    // Send message to content script to update
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) {
        showStatus('Error connecting to tab', 'error');
        return;
      }
      
      try {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'updateConfig', config },
          (response) => {
            // Check for error
            if (chrome.runtime.lastError) {
              // This is expected to happen if the content script isn't loaded yet
              console.error('Connection error:', chrome.runtime.lastError);
              showStatus('Changes saved, but not applied to current page. Try refreshing.', 'error');
              // Still save the settings even if we can't apply them right now
              return;
            }
            
            if (response && response.success) {
              showStatus('Settings saved!');
            }
          }
        );
      } catch (error) {
        console.error('Error sending message:', error);
        showStatus('Error applying settings. Try refreshing the page.', 'error');
      }
    });
  });
}

// Set up event listeners
function setupEventListeners() {
  // Toggle switches
  elements.hideFeedItems.addEventListener('change', (e) => {
    config.hideFeedItems = e.target.checked;
    saveConfig();
  });
  
  elements.hideNavButtons.addEventListener('change', (e) => {
    config.hideNavButtons = e.target.checked;
    saveConfig();
  });
  
  elements.hidePartyWidget.addEventListener('change', (e) => {
    config.hidePartyWidget = e.target.checked;
    saveConfig();
  });
  
  elements.hideNotifications.addEventListener('change', (e) => {
    config.hideNotifications = e.target.checked;
    saveConfig();
  });
}

// Disable controls (when not on faceit.com)
function disableControls() {
  document.querySelectorAll('input, button').forEach(element => {
    element.disabled = true;
  });
}

// Show status message
function showStatus(message, type = 'success') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = type === 'error' ? '#ff3333' : '#00cc66';
  
  setTimeout(() => {
    elements.statusMessage.textContent = '';
  }, 3000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPopup); 