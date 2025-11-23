// Background service worker for handling OAuth and extension lifecycle

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Extension was just installed
    // When user clicks the extension icon, popup.js will check auth status
    // and show login screen if not authenticated
    console.log('Prompt Refiner extension installed');
  } else if (details.reason === 'update') {
    // Extension was updated - check auth status
    checkAuthStatus();
  }
});

// Note: When the extension is uninstalled, Chrome automatically clears all extension data
// including chrome.storage.local and localStorage, so tokens are automatically deleted.
// No additional cleanup code is needed.

// Check authentication status
async function checkAuthStatus() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['googleAuthToken', 'googleUserInfo'], (result) => {
      const isAuthenticated = !!(result.googleAuthToken && result.googleUserInfo);
      resolve(isAuthenticated);
    });
  });
}

// Handle OAuth token from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storeAuthToken') {
    // Store authentication token and user info
    chrome.storage.local.set({
      googleAuthToken: request.token,
      googleUserInfo: request.userInfo,
      authTimestamp: Date.now()
    }, () => {
      sendResponse({ success: true });
    });
    return true; // Keep the message channel open for async response
  } else if (request.action === 'getAuthToken') {
    // Get stored authentication token
    chrome.storage.local.get(['googleAuthToken', 'googleUserInfo'], (result) => {
      sendResponse({
        token: result.googleAuthToken,
        userInfo: result.googleUserInfo
      });
    });
    return true;
  } else if (request.action === 'clearAuthToken') {
    // Clear authentication token
    chrome.storage.local.remove(['googleAuthToken', 'googleUserInfo', 'authTimestamp'], () => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'checkAuthStatus') {
    // Check if user is authenticated
    checkAuthStatus().then((isAuthenticated) => {
      sendResponse({ isAuthenticated });
    });
    return true;
  }
});

// Listen for storage changes to detect uninstall (fallback)
// Note: This is a workaround since Chrome doesn't provide a direct uninstall event
// The actual cleanup happens when the extension is removed

