(function () {
  'use strict';

  /* ================= CONSTANTS ================= */
  const CONSTANTS = {
    MAX_CACHE: 20,
    SELECTORS: {
      FILE_INPUT: 'input[type="file"]',
      CHAT_FORM: 'form',
      PILL_CANDIDATES: 'button, div[role="button"], .group',
    }
  };

  /* ================= CONFIGURATION ================= */
  const DEFAULT_CONFIG = {
    charThreshold: 2000,
    enablePreview: true,
    filenamePrefix: "Snippet_"
  };
  let config = { ...DEFAULT_CONFIG };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(DEFAULT_CONFIG, (items) => { config = { ...config, ...items }; });
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.charThreshold) config.charThreshold = changes.charThreshold.newValue;
        if (changes.enablePreview) config.enablePreview = changes.enablePreview.newValue;
        if (changes.filenamePrefix) config.filenamePrefix = changes.filenamePrefix.newValue;
      });
    }
  } catch (e) { }

  /* ================= STATE ================= */
  const snippetCache = new Map();

  function cacheSnippet(filename, content) {
    if (snippetCache.size >= CONSTANTS.MAX_CACHE) {
      const firstKey = snippetCache.keys().next().value;
      snippetCache.delete(firstKey);
    }
    snippetCache.set(filename, content);
  }

  function generateUniqueFilename() {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const safePrefix = config.filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safePrefix}${time}_${rand}.txt`;
  }

  /* ================= INJECTION ENGINE ================= */
  function injectFileIntoChatGPT(file) {
    const fileInput = document.querySelector(CONSTANTS.SELECTORS.FILE_INPUT);
    if (!fileInput) return false;
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) { return false; }
  }

  /* ================= HUMAN CLICK SIMULATOR (THE FIX) ================= */
  function simulateHumanClick(element) {
    // React expects a full event sequence, not just .click()
    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    eventTypes.forEach(type => {
      const evt = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1, // Left click
        composed: true
      });
      element.dispatchEvent(evt);
    });
  }

  /* ================= SAFE DELETE FINDER ================= */
  function findDeleteButtonSafe(pillElement) {
    const isValidDeleteBtn = (btn) => {
      if (!btn) return false;
      // CRITICAL: Ignore the Send Button
      if (btn.getAttribute('data-testid') === 'send-button') return false;
      const label = (btn.ariaLabel || "").toLowerCase();
      if (label.includes('send')) return false;

      // Must look like a delete button
      if (label.includes('remove') || label.includes('delete')) return true;
      return false;
    };

    // 1. Check parent wrapper
    const wrapper = pillElement.closest('.group');
    if (wrapper) {
      const candidates = wrapper.querySelectorAll('button');
      for (let c of candidates) {
        if (c === pillElement) continue;
        if (isValidDeleteBtn(c)) return c;
      }
    }

    // 2. Fallback: Direct Sibling Check
    if (pillElement.parentElement) {
      const siblingBtn = pillElement.parentElement.querySelector('button[aria-label*="Remove"]');
      if (siblingBtn && isValidDeleteBtn(siblingBtn)) return siblingBtn;
    }

    return null;
  }

  /* ================= EDITABLE MODAL ================= */
  function createModal(filename, text, pillElement) {
    const existing = document.querySelector('.cgpt-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "cgpt-modal-overlay";
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const content = document.createElement("div");
    content.className = "cgpt-modal-content";
    content.setAttribute('tabindex', '-1');

    const header = document.createElement("div");
    header.className = "cgpt-modal-header";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = "Editing: " + filename;
    titleSpan.style.fontWeight = "600";

    const actions = document.createElement("div");
    actions.className = "cgpt-modal-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "cgpt-btn-primary";
    saveBtn.textContent = "Save & Update";
    saveBtn.type = "button";

    const closeBtn = document.createElement("button");
    closeBtn.className = "cgpt-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.type = "button";

    actions.appendChild(saveBtn);
    actions.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(actions);

    const body = document.createElement("textarea");
    body.className = "cgpt-modal-editor";
    body.value = text;
    body.spellcheck = false;

    content.appendChild(header);
    content.appendChild(body);
    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    // --- PROGRAMMATIC HOT SWAP LOGIC ---
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const newText = body.value;
      saveBtn.textContent = "Updating...";
      saveBtn.disabled = true;

      // 1. Update Memory
      cacheSnippet(filename, newText);

      // 2. SAFETY NET: Block Accidental Form Submission
      // If our delete click falls through, we catch the form submit and KILL IT.
      const form = document.querySelector('form');
      const submitBlocker = (evt) => {
        console.log("[GPT-Opt] Blocked accidental submit during update.");
        evt.preventDefault();
        evt.stopImmediatePropagation();
      };

      if (form) {
        // Attach high-priority capture listener
        form.addEventListener('submit', submitBlocker, { capture: true, once: true });
        // Clean up listener after 300ms (window where click might happen)
        setTimeout(() => form.removeEventListener('submit', submitBlocker, { capture: true }), 300);
      }

      // 3. Perform Delete (With Human Simulation)
      const deleteBtn = findDeleteButtonSafe(pillElement);
      if (deleteBtn) {
        simulateHumanClick(deleteBtn);
      } else {
        console.warn("[GPT-Opt] Delete button not found. Duplicate may occur.");
      }

      // 4. Inject New File
      setTimeout(() => {
        const newFile = new File([newText], filename, { type: "text/plain" });
        const success = injectFileIntoChatGPT(newFile);

        if (success) {
          close();
        } else {
          saveBtn.textContent = "Error";
          alert("Update failed. Text copied to clipboard.");
          navigator.clipboard.writeText(newText);
        }
      }, 100);
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    content.focus();
  }

  /* ================= MAIN LOGIC ================= */
  function handlePaste(e) {
    const target = e.target;
    const isEditable = target.isContentEditable || target.tagName === 'TEXTAREA';
    const isChatBox = target.closest(CONSTANTS.SELECTORS.CHAT_FORM) || target.closest('[class*="prompt"]');

    if (!isEditable || !isChatBox) return;

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text');
    if (!text || text.length < config.charThreshold) return;

    e.preventDefault();
    e.stopPropagation();

    const filename = generateUniqueFilename();
    cacheSnippet(filename, text);

    const file = new File([text], filename, { type: "text/plain" });
    const success = injectFileIntoChatGPT(file);

    if (!success) document.execCommand('insertText', false, text);
  }

  const observer = new MutationObserver((mutations) => {
    if (!config.enablePreview) return;
    if (!mutations.some(m => m.addedNodes.length > 0)) return;

    const candidates = document.querySelectorAll(CONSTANTS.SELECTORS.PILL_CANDIDATES);

    candidates.forEach(el => {
      if (el.dataset.cgptBound) return;
      if (!el.closest(CONSTANTS.SELECTORS.CHAT_FORM)) return;

      const txt = el.textContent || "";
      if (!txt.includes(config.filenamePrefix)) return;

      for (const [fname, content] of snippetCache.entries()) {
        if (txt.includes(fname) || (fname.length > 15 && txt.includes(fname.substring(0, 15)))) {
          el.dataset.cgptBound = "true";
          el.classList.add('cgpt-snippet-pill');
          el.title = "Click to Edit";

          el.addEventListener('click', (ev) => {
            // Ignore clicks on buttons inside the pill
            if (ev.target.closest('button')) return;
            if (!ev.target.closest(CONSTANTS.SELECTORS.CHAT_FORM)) return;

            ev.preventDefault();
            ev.stopPropagation();
            createModal(fname, content, el);
          }, true);
          break;
        }
      }
    });
  });

  function init() {
    document.addEventListener('paste', handlePaste, true);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();