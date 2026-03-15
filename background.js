/**
 * PropVision AI Assistant — Background Service Worker
 * 
 * In Manifest V3, content scripts are subject to the host page's CSP and mixed content rules.
 * This background script handles API requests (like fetching from http://localhost:8001)
 * to bypass the HTTPS-to-HTTP mixed content blocks on OLX listings.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FETCH_API') {
    fetch(message.url, message.options)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
        }
        const data = await response.json();
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
});
