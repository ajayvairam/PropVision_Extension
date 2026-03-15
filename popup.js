/**
 * PropVision AI Assistant — Popup Script
 * 
 * Handles the extension popup dashboard:
 * - "Scan Page" button: sends SCAN_PAGE message to content.js
 * - "Analyze Images" button: sends ANALYZE_IMAGES message to content.js
 * - Updates summary cards and detailed results list in real-time
 */

(() => {
  'use strict';

  // ─── DOM References ──────────────────────────────────────────────
  const btnScan = document.getElementById('btnScan');
  const btnAnalyze = document.getElementById('btnAnalyze');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const summarySection = document.getElementById('summarySection');
  const resultsSection = document.getElementById('resultsSection');
  const resultsList = document.getElementById('resultsList');
  const emptyState = document.getElementById('emptyState');
  const connectionStatus = document.getElementById('connectionStatus');

  // Summary card values
  const totalImagesEl = document.getElementById('totalImages');
  const bedroomCountEl = document.getElementById('bedroomCount');
  const kitchenCountEl = document.getElementById('kitchenCount');
  const suspiciousCountEl = document.getElementById('suspiciousCount');
  const imageCountFooter = document.getElementById('imageCountFooter');

  // ─── State ───────────────────────────────────────────────────────
  let scannedUrls = [];
  let isAnalyzing = false;

  // ─── Utility: Get the current active tab ─────────────────────────
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ─── Utility: Send message to content script (with auto-inject) ─
  async function sendToContentScript(action, data = {}) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      throw new Error('No active tab found');
    }

    const sendMessage = () => new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

    try {
      return await sendMessage();
    } catch (e) {
      // If content script isn't loaded, inject it programmatically
      if (e.message.includes('Receiving end does not exist') || e.message.includes('Could not establish connection')) {
        console.log('[PropVision Popup] Content script missing. Auto-injecting...');
        
        try {
          // Inject CSS first
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['styles.css']
          });
          
          // Inject JS
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          // Wait a short moment for the script to initialize
          await new Promise(r => setTimeout(r, 200));

          // Retry sending the message
          return await sendMessage();
        } catch (injectError) {
          throw new Error('Cannot inject script into this page. Please navigate to a standard OLX listing page.');
        }
      }
      throw e;
    }
  }

  // ─── Show/hide progress indicator ───────────────────────────────
  function showProgress(text = 'Analyzing...') {
    progressContainer.style.display = 'block';
    progressText.textContent = text;
    progressFill.style.width = '0%';

    // Animate progress bar
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) {
        clearInterval(interval);
        progress = 90;
      }
      progressFill.style.width = `${progress}%`;
    }, 300);

    return interval;
  }

  function hideProgress(interval) {
    if (interval) clearInterval(interval);
    progressFill.style.width = '100%';
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 500);
  }

  // ─── Update connection status indicator ──────────────────────────
  function setStatus(text, type = 'ready') {
    const dot = connectionStatus.querySelector('.status-dot');
    const label = connectionStatus.querySelector('.status-text');
    label.textContent = text;
    dot.className = `status-dot status-${type}`;
  }

  // ─── Scan Page Handler ──────────────────────────────────────────
  btnScan.addEventListener('click', async () => {
    if (isAnalyzing) return;

    btnScan.disabled = true;
    setStatus('Scanning...', 'active');

    try {
      const response = await sendToContentScript('SCAN_PAGE');

      if (response && response.success) {
        scannedUrls = response.urls || [];
        const count = response.imageCount || 0;

        // Update UI
        imageCountFooter.textContent = `${count} image${count !== 1 ? 's' : ''}`;
        totalImagesEl.textContent = count;

        if (count > 0) {
          emptyState.style.display = 'none';
          summarySection.style.display = 'block';
          btnAnalyze.disabled = false;
          setStatus(`${count} found`, 'success');
        } else {
          emptyState.style.display = 'flex';
          setStatus('No images', 'warning');
        }
      } else {
        setStatus('Scan failed', 'error');
      }
    } catch (error) {
      console.error('[PropVision Popup] Scan error:', error);
      setStatus('Not on OLX', 'error');
      emptyState.querySelector('.empty-title').textContent = 'Content script not loaded';
      emptyState.querySelector('.empty-desc').innerHTML = 
        'Navigate to an <strong>OLX.in</strong> property listing page first.';
    } finally {
      btnScan.disabled = false;
    }
  });

  // ─── Analyze Images Handler ─────────────────────────────────────
  btnAnalyze.addEventListener('click', async () => {
    if (isAnalyzing || scannedUrls.length === 0) return;

    isAnalyzing = true;
    btnAnalyze.disabled = true;
    btnScan.disabled = true;
    setStatus('Analyzing...', 'active');

    const progressInterval = showProgress('Sending images to AI engine...');

    try {
      const response = await sendToContentScript('ANALYZE_IMAGES');

      if (response && response.error) {
        throw new Error(response.error);
      }

      if (response && response.success) {
        hideProgress(progressInterval);

        const { summary, results } = response;

        // Update summary cards
        updateSummaryCards(summary);

        // Populate detailed results
        populateResults(results);

        // Show results sections
        summarySection.style.display = 'block';
        resultsSection.style.display = 'block';

        setStatus('Complete', 'success');
      } else {
        throw new Error('Unexpected response from content script');
      }

    } catch (error) {
      console.error('[PropVision Popup] Analysis error:', error);
      hideProgress(progressInterval);
      setStatus('Error', 'error');
      
      // Show error in results
      resultsList.innerHTML = `
        <div class="result-item result-error">
          <div class="result-error-icon">✗</div>
          <div>
            <strong>Analysis Failed</strong>
            <p>${error.message}</p>
            <p class="result-error-hint">Make sure the FastAPI backend is running on <code>http://localhost:8001</code></p>
          </div>
        </div>
      `;
      resultsSection.style.display = 'block';
    } finally {
      isAnalyzing = false;
      btnAnalyze.disabled = false;
      btnScan.disabled = false;
    }
  });

  // ─── Update summary cards with analysis results ─────────────────
  function updateSummaryCards(summary) {
    if (!summary) return;

    totalImagesEl.textContent = summary.totalImages || 0;
    bedroomCountEl.textContent = summary.roomCounts?.['Bedroom'] || 0;
    kitchenCountEl.textContent = summary.roomCounts?.['Kitchen'] || 0;
    suspiciousCountEl.textContent = summary.suspiciousCount || 0;

    // Animate the suspicious count if > 0
    const suspCard = suspiciousCountEl.closest('.summary-card');
    if (summary.suspiciousCount > 0) {
      suspCard.classList.add('summary-card-alert');
    } else {
      suspCard.classList.remove('summary-card-alert');
    }
  }

  // ─── Populate detailed results list ─────────────────────────────
  function populateResults(results) {
    if (!results || results.length === 0) {
      resultsList.innerHTML = '<p class="no-results">No results available</p>';
      return;
    }

    resultsList.innerHTML = results.map((r, i) => {
      const fakeScore = r.fake_image_score || 0;
      let scoreClass, scoreLabel;

      if (fakeScore >= 0.7) {
        scoreClass = 'score-danger';
        scoreLabel = 'Suspicious';
      } else if (fakeScore >= 0.4) {
        scoreClass = 'score-warning';
        scoreLabel = 'Caution';
      } else {
        scoreClass = 'score-safe';
        scoreLabel = 'Safe';
      }

      const objects = (r.objects || []).join(', ') || 'None detected';
      const qualityPercent = ((r.quality_score || 0) * 100).toFixed(0);

      // Truncate URL for display
      const displayUrl = (r.image_url || '').split('/').pop()?.substring(0, 30) || `Image ${i + 1}`;

      return `
        <div class="result-item">
          <div class="result-header">
            <span class="result-room">${r.room_type || 'Unknown'}</span>
            <span class="result-score ${scoreClass}">${scoreLabel} (${(fakeScore * 100).toFixed(0)}%)</span>
          </div>
          <div class="result-details">
            <div class="result-row">
              <span class="result-label">Objects:</span>
              <span class="result-value">${objects}</span>
            </div>
            <div class="result-row">
              <span class="result-label">Quality:</span>
              <div class="quality-bar-container">
                <div class="quality-bar" style="width: ${qualityPercent}%"></div>
                <span class="quality-text">${qualityPercent}%</span>
              </div>
            </div>
            <div class="result-row result-url">
              <span class="result-label">File:</span>
              <span class="result-value result-filename" title="${r.image_url || ''}">${displayUrl}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── On popup open: check if we have stored results ─────────────
  async function init() {
    try {
      // Try to get current status from content script
      const response = await sendToContentScript('GET_STATUS');
      if (response && response.imageCount > 0) {
        scannedUrls = response.urls || [];
        imageCountFooter.textContent = `${response.imageCount} image${response.imageCount !== 1 ? 's' : ''}`;
        totalImagesEl.textContent = response.imageCount;
        emptyState.style.display = 'none';
        summarySection.style.display = 'block';
        btnAnalyze.disabled = false;
        setStatus(`${response.imageCount} found`, 'success');

        // If already analyzed, load stored results
        if (response.analyzedCount > 0) {
          const stored = await chrome.storage.local.get(['propvision_results', 'propvision_summary']);
          if (stored.propvision_results) {
            updateSummaryCards(stored.propvision_summary);
            populateResults(stored.propvision_results);
            resultsSection.style.display = 'block';
            setStatus('Complete', 'success');
          }
        }
      }
    } catch (e) {
      // Content script not available — show default state
      console.log('[PropVision Popup] Waiting for content script...');
    }
  }

  init();

})();
