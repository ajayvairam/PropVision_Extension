/**
 * PropVision AI Assistant — Content Script
 * 
 * Runs on OLX.in property listing pages.
 * - Observes the DOM for dynamically loaded images (MutationObserver)
 * - Extracts <img> src and background-image URLs
 * - Filters images by size (> 300px) to exclude icons/ads
 * - Injects floating analysis badges on each qualifying image
 * - Communicates with popup.js and the FastAPI backend
 */

(() => {
  'use strict';

  // ─── Configuration ───────────────────────────────────────────────
  const API_BASE_URL = 'http://localhost:8001';
  const MIN_IMAGE_SIZE = 300; // px — ignore images smaller than this
  const BADGE_CLASS = 'propvision-badge';
  const WRAPPER_CLASS = 'propvision-wrapper';
  const PROCESSED_ATTR = 'data-propvision-processed';

  // ─── State ───────────────────────────────────────────────────────
  let discoveredImages = new Map(); // url -> { element, badge, result }

  // ─── Utility: Extract image URL from an element ──────────────────
  function extractImageUrl(el) {
    // Check <img> src
    if (el.tagName === 'IMG' && el.src) {
      return el.src;
    }
    // Check background-image
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match) return match[1];
    }
    return null;
  }

  // ─── Utility: Check if image is large enough to be a listing photo ─
  function isListingImage(el) {
    // For <img> elements, check natural or rendered size
    if (el.tagName === 'IMG') {
      const width = el.naturalWidth || el.offsetWidth || el.width;
      const height = el.naturalHeight || el.offsetHeight || el.height;
      return width >= MIN_IMAGE_SIZE || height >= MIN_IMAGE_SIZE;
    }
    // For background-image elements, check rendered size
    return el.offsetWidth >= MIN_IMAGE_SIZE || el.offsetHeight >= MIN_IMAGE_SIZE;
  }

  // ─── Utility: Check if URL is valid for analysis ─────────────────
  function isValidImageUrl(url) {
    if (!url) return false;
    // Skip data URIs, SVGs, and tiny tracking pixels
    if (url.startsWith('data:')) return false;
    if (url.endsWith('.svg')) return false;
    if (url.includes('tracking') || url.includes('pixel')) return false;
    return true;
  }

  // ─── Create the floating analysis badge ──────────────────────────
  function createBadge() {
    const badge = document.createElement('div');
    badge.className = BADGE_CLASS;
    badge.innerHTML = `
      <div class="propvision-badge-inner">
        <div class="propvision-badge-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <span class="propvision-badge-text">PropVision</span>
        <span class="propvision-badge-status propvision-status-pending">Ready</span>
      </div>
    `;
    return badge;
  }

  // ─── Update badge with analysis result ───────────────────────────
  function updateBadge(badge, result) {
    if (!badge || !result) return;

    const statusEl = badge.querySelector('.propvision-badge-status');
    const textEl = badge.querySelector('.propvision-badge-text');

    if (!statusEl || !textEl) return;

    // Determine alert level based on fake_image_score
    const fakeScore = result.fake_image_score || 0;
    let alertClass, alertText;

    if (fakeScore >= 0.7) {
      alertClass = 'propvision-status-danger';
      alertText = '⚠ Suspicious';
    } else if (fakeScore >= 0.4) {
      alertClass = 'propvision-status-warning';
      alertText = '⚡ Caution';
    } else {
      alertClass = 'propvision-status-safe';
      alertText = '✓ Safe';
    }

    // Update badge content
    textEl.textContent = result.room_type || 'Unknown';
    statusEl.textContent = alertText;
    statusEl.className = `propvision-badge-status ${alertClass}`;

    // Add quality score tooltip
    badge.title = `Room: ${result.room_type}\nObjects: ${(result.objects || []).join(', ')}\nQuality: ${((result.quality_score || 0) * 100).toFixed(0)}%\nFake Score: ${(fakeScore * 100).toFixed(0)}%`;
  }

  // ─── Set badge to "analyzing" state ──────────────────────────────
  function setBadgeAnalyzing(badge) {
    if (!badge) return;
    const statusEl = badge.querySelector('.propvision-badge-status');
    if (statusEl) {
      statusEl.textContent = '⏳ Analyzing...';
      statusEl.className = 'propvision-badge-status propvision-status-analyzing';
    }
  }

  // ─── Inject badge onto an image element ──────────────────────────
  function injectBadge(el, url) {
    if (el.getAttribute(PROCESSED_ATTR)) return;
    el.setAttribute(PROCESSED_ATTR, 'true');

    // Create a wrapper to hold the image and badge in position
    const parent = el.parentElement;
    if (!parent) return;

    // Ensure parent has relative positioning for badge placement
    const parentPosition = window.getComputedStyle(parent).position;
    if (parentPosition === 'static') {
      parent.style.position = 'relative';
    }

    const badge = createBadge();
    parent.appendChild(badge);

    // Store reference
    discoveredImages.set(url, {
      element: el,
      badge: badge,
      result: null
    });
  }

  // ─── Scan current DOM for qualifying images ──────────────────────
  function scanForImages() {
    const elements = [];

    // Scan <img> tags
    document.querySelectorAll('img').forEach(img => {
      if (img.getAttribute(PROCESSED_ATTR)) return;
      const url = extractImageUrl(img);
      if (url && isValidImageUrl(url) && isListingImage(img)) {
        elements.push({ element: img, url });
      }
    });

    // Scan elements with background-image
    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      if (el.getAttribute(PROCESSED_ATTR)) return;
      const url = extractImageUrl(el);
      if (url && isValidImageUrl(url) && isListingImage(el)) {
        elements.push({ element: el, url });
      }
    });

    // Inject badges on discovered images
    elements.forEach(({ element, url }) => {
      injectBadge(element, url);
    });

    return discoveredImages.size;
  }

  // ─── For images that didn't pass size check initially, re-check ──
  function reCheckPendingImages() {
    document.querySelectorAll('img:not([data-propvision-processed])').forEach(img => {
      const url = extractImageUrl(img);
      if (url && isValidImageUrl(url) && isListingImage(img)) {
        injectBadge(img, url);
      }
    });
  }

  // ─── MutationObserver: Watch for dynamically loaded images ───────
  const observer = new MutationObserver((mutations) => {
    let hasNewImages = false;

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Direct image nodes
        if (node.tagName === 'IMG') {
          hasNewImages = true;
        }

        // Descendants containing images
        if (node.querySelectorAll) {
          const imgs = node.querySelectorAll('img');
          if (imgs.length > 0) hasNewImages = true;
        }
      }

      // Check attribute changes on images (e.g., lazy-loaded src updates)
      if (mutation.type === 'attributes' && mutation.target.tagName === 'IMG') {
        if (mutation.attributeName === 'src' || mutation.attributeName === 'data-src') {
          hasNewImages = true;
        }
      }
    }

    if (hasNewImages) {
      // Debounce: wait for DOM to settle before scanning
      clearTimeout(observer._debounceTimer);
      observer._debounceTimer = setTimeout(() => {
        scanForImages();
      }, 500);
    }
  });

  // Start observing the document
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'style']
  });

  // ─── Initial scan on page load ───────────────────────────────────
  // Some images may be loaded before observer starts; re-check after images load
  window.addEventListener('load', () => {
    setTimeout(scanForImages, 1000);
    setTimeout(reCheckPendingImages, 3000);
  });

  // Also scan immediately
  scanForImages();

  // ─── Analyze images via FastAPI backend ──────────────────────────
  async function analyzeImages() {
    const urls = Array.from(discoveredImages.keys());

    if (urls.length === 0) {
      return { error: 'No images found. Try scanning the page first.' };
    }

    // Set all badges to analyzing state
    discoveredImages.forEach(({ badge }) => setBadgeAnalyzing(badge));

    try {
      // Send request via background.js to bypass Mixed Content restrictions
      const response = await chrome.runtime.sendMessage({
        action: 'FETCH_API',
        url: `${API_BASE_URL}/analyze-images`,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_urls: urls })
        }
      });

      if (!response || !response.success) {
        throw new Error(response ? response.error : "Failed to connect to background script");
      }

      const data = response.data;
      const results = data.results || [];

      // Map results back to badges
      results.forEach((result) => {
        const imageData = discoveredImages.get(result.image_url);
        if (imageData) {
          imageData.result = result;
          updateBadge(imageData.badge, result);
        }
      });

      // Build summary
      const summary = buildSummary(results);
      
      // Store results for popup to retrieve
      await chrome.storage.local.set({ 
        propvision_results: results,
        propvision_summary: summary 
      });

      return { success: true, summary, results };

    } catch (error) {
      console.error('[PropVision] Analysis failed:', error);
      
      // Reset badges to error state
      discoveredImages.forEach(({ badge }) => {
        const statusEl = badge.querySelector('.propvision-badge-status');
        if (statusEl) {
          statusEl.textContent = '✗ Error';
          statusEl.className = 'propvision-badge-status propvision-status-danger';
        }
      });

      return { error: error.message };
    }
  }

  // ─── Build summary statistics from results ──────────────────────
  function buildSummary(results) {
    const summary = {
      totalImages: results.length,
      roomCounts: {},
      suspiciousCount: 0,
      averageQuality: 0
    };

    let qualitySum = 0;

    results.forEach(r => {
      // Count room types
      const room = r.room_type || 'Unknown';
      summary.roomCounts[room] = (summary.roomCounts[room] || 0) + 1;

      // Count suspicious images (fake_image_score >= 0.7)
      if ((r.fake_image_score || 0) >= 0.7) {
        summary.suspiciousCount++;
      }

      qualitySum += (r.quality_score || 0);
    });

    summary.averageQuality = results.length > 0 ? qualitySum / results.length : 0;

    return summary;
  }

  // ─── Message handler: communicate with popup.js ──────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SCAN_PAGE') {
      // Perform a full scan and return count
      const count = scanForImages();
      const urls = Array.from(discoveredImages.keys());
      sendResponse({ success: true, imageCount: count, urls });
      return true;
    }

    if (message.action === 'ANALYZE_IMAGES') {
      // Run analysis (async) — must return true for async sendResponse
      analyzeImages().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // Keep message channel open for async response
    }

    if (message.action === 'GET_STATUS') {
      const urls = Array.from(discoveredImages.keys());
      const results = Array.from(discoveredImages.values())
        .filter(d => d.result)
        .map(d => d.result);
      sendResponse({ 
        imageCount: discoveredImages.size, 
        analyzedCount: results.length,
        urls 
      });
      return true;
    }
  });

})();
