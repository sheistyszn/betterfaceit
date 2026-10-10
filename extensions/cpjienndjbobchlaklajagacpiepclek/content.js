// Faceit UI Cleaner - Content Script

// Configuration will be loaded from storage
let config = {
  hideFeedItems: true,
  hideNavButtons: true,
  hidePartyWidget: true,
  hideNotifications: true
};

// Element selectors mapping
const elementSelectors = {
  feedItems: 'div[class^="style__Watch-sc-"], div[class^="style__Shop-sc-"], div[class^="style__News-sc-"], div[class^="style__Events-sc-"], div[class^="style__Feed-sc-"], div[class^="Ladders__Container-sc-"], div[class^="Ladders__HeaderContainer-sc-"]',
  navButtons: 'a[aria-label="Watch"], a[aria-label="Feed"], a[aria-label="Missions"], a[aria-label="Shop"], a[aria-label="Clubs"], a[aria-label="Create a Club"], a[aria-label="Party Finder"], a[aria-label="Rank"]',
  partyWidget: 'div[class^="stylesV2__BubbleWrapper-sc-"]',
  notifications: 'button[aria-label="Notifications"]'
};

// Load configuration from storage
function loadConfig() {
  try {
    chrome.storage.sync.get('faceitCleanerConfig', (data) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading config:', chrome.runtime.lastError);
        return;
      }
      
      if (data.faceitCleanerConfig) {
        config = {...config, ...data.faceitCleanerConfig};
      }
      applyConfig();
    });
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// Apply configuration to hide elements
function applyConfig() {
  try {
    console.log("Applying config:", JSON.stringify(config));
    
    // Apply basic hiding rules
    toggleElements('feedItems', config.hideFeedItems);
    toggleElements('navButtons', config.hideNavButtons);
    toggleElements('partyWidget', config.hidePartyWidget);
    toggleElements('notifications', config.hideNotifications);
    
    // Apply specific widget hiding (using JS-based approach)
    if (config.hideFeedItems) {
      hideWidgetsByTitle();
    } else {
      // Remove hidden class from widget titles
      showWidgetsByTitle();
    }
    
    // Hide Tournaments/League buttons
    if (config.hideNavButtons) {
      hideLeagueTournamentButtons();
    } else {
      // Remove hidden class from League/Tournament buttons
      showLeagueTournamentButtons();
    }
  } catch (error) {
    console.error('Error applying config:', error);
  }
}

// Toggle elements visibility based on config
function toggleElements(elementType, shouldHide) {
  try {
    const selector = elementSelectors[elementType];
    if (!selector) return;
    
    console.log(`Toggling ${elementType} elements: ${shouldHide ? 'hide' : 'show'}`);
    
    const elements = document.querySelectorAll(selector);
    console.log(`Found ${elements.length} elements for selector: ${selector}`);
    
    elements.forEach(element => {
      if (shouldHide) {
        element.classList.add('faceit-cleaner-hidden');
      } else {
        element.classList.remove('faceit-cleaner-hidden');
      }
    });
  } catch (error) {
    console.error(`Error toggling ${elementType} elements:`, error);
  }
}

// Notify the popup that the content script is alive
function registerContentScript() {
  chrome.runtime.sendMessage({ action: 'contentScriptReady' }, function(response) {
    // Handle any response if needed
    if (chrome.runtime.lastError) {
      // Ignore errors - popup might not be open
      console.debug('Popup not available, continuing silently');
    }
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'updateConfig') {
      config = {...config, ...message.config};
      applyConfig();
      sendResponse({success: true});
    } else if (message.action === 'getConfig') {
      sendResponse({config});
    } else if (message.action === 'ping') {
      // Simple ping to check if content script is alive
      sendResponse({status: 'alive'});
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({success: false, error: error.message});
  }
  return true;  // Keep the message channel open for asynchronous response
});

// Set up mutation observer to handle dynamically loaded content
function setupObserver() {
  try {
    const observer = new MutationObserver((mutations) => {
      applyConfig();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  } catch (error) {
    console.error('Error setting up observer:', error);
  }
}

// Hide widget containers by finding titles with specific text
function hideWidgetsByTitle() {
  try {
    const widgetTitles = [
      "Monthly ladders",
      "Skill level",
      "Missions"
    ];
    
    // Find all span elements that might be widget titles
    const spans = document.querySelectorAll('span[class*="WidgetTitleWrapper__NewEloWidgetTitle-sc-"]');
    
    spans.forEach(span => {
      // Check if the span contains one of our target titles
      for (const title of widgetTitles) {
        if (span.textContent.includes(title)) {
          // Navigate up to find the component container
          let element = span;
          while (element && !element.className.includes('Header__ComponentContainer-sc-')) {
            element = element.parentElement;
          }
          
          // If we found the container, hide it
          if (element) {
            element.classList.add('faceit-cleaner-hidden');
          }
          break;
        }
      }
    });
  } catch (error) {
    console.error('Error hiding widgets by title:', error);
  }
}

// Show widget containers by finding titles with specific text
function showWidgetsByTitle() {
  try {
    const widgetTitles = [
      "Monthly ladders",
      "Skill level",
      "Missions"
    ];
    
    // Find all span elements that might be widget titles
    const spans = document.querySelectorAll('span[class*="WidgetTitleWrapper__NewEloWidgetTitle-sc-"]');
    
    spans.forEach(span => {
      // Check if the span contains one of our target titles
      for (const title of widgetTitles) {
        if (span.textContent.includes(title)) {
          // Navigate up to find the component container
          let element = span;
          while (element && !element.className.includes('Header__ComponentContainer-sc-')) {
            element = element.parentElement;
          }
          
          // If we found the container, show it
          if (element) {
            element.classList.remove('faceit-cleaner-hidden');
          }
          break;
        }
      }
    });
  } catch (error) {
    console.error('Error showing widgets by title:', error);
  }
}

// Hide League and Tournament buttons by finding spans with specific text
function hideLeagueTournamentButtons() {
  try {
    const buttonLabels = ["Tournaments", "League"];
    
    // Find all spans that might be button labels
    const spans = document.querySelectorAll('span[class^="TopBar__TopBarLabel-sc-"]');
    
    spans.forEach(span => {
      // Check if the span contains one of our target labels
      for (const label of buttonLabels) {
        if (span.textContent.includes(label)) {
          // Navigate up to find the button
          let element = span;
          while (element && element.tagName !== 'BUTTON') {
            element = element.parentElement;
          }
          
          // If we found the button, hide it
          if (element) {
            element.classList.add('faceit-cleaner-hidden');
          }
          break;
        }
      }
    });
  } catch (error) {
    console.error('Error hiding League/Tournament buttons:', error);
  }
}

// Show League and Tournament buttons
function showLeagueTournamentButtons() {
  try {
    const buttonLabels = ["Tournaments", "League"];
    
    // Find all spans that might be button labels
    const spans = document.querySelectorAll('span[class^="TopBar__TopBarLabel-sc-"]');
    
    spans.forEach(span => {
      // Check if the span contains one of our target labels
      for (const label of buttonLabels) {
        if (span.textContent.includes(label)) {
          // Navigate up to find the button
          let element = span;
          while (element && element.tagName !== 'BUTTON') {
            element = element.parentElement;
          }
          
          // If we found the button, show it
          if (element) {
            element.classList.remove('faceit-cleaner-hidden');
          }
          break;
        }
      }
    });
  } catch (error) {
    console.error('Error showing League/Tournament buttons:', error);
  }
}

// Initialize
function init() {
  try {
    loadConfig();
    setupObserver();
    registerContentScript();
    
    // Initial application after short delay to ensure page is loaded
    setTimeout(applyConfig, 1000);
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

// Run initialization when the page is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 