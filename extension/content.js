// content.js

// Extract readable text of the current page
function getPageText() {
  try {
    // Clone the document to avoid modifying the original
    const docClone = document.cloneNode(true);

    // Remove script and style elements from clone
    const scripts = docClone.querySelectorAll('script, style, noscript');
    scripts.forEach(el => el.remove());

    // Get text content
    const bodyText = docClone.body ? docClone.body.innerText : '';
    const title = document.title || '';

    return title + '\n\n' + bodyText.trim();
  } catch (error) {
    console.error('Error getting page text:', error);
    return document.title || 'Error extracting page text';
  }
}

// Try to fill forms by best-effort label matching
function fillForm(fields, submit) {
  const norm = (s) => (s || "").toString().toLowerCase().trim();
  const results = { filled: [], unmatched: [], submitted: false };

  try {
    const inputs = Array.from(document.querySelectorAll(
      "input, textarea, select"
    ));

    function labelText(el) {
      // associated <label for="id">
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return lab.innerText;
      }
      // parent label
      const parentLabel = el.closest("label");
      if (parentLabel) return parentLabel.innerText;
      return "";
    }

    function matches(el, key) {
      const k = norm(key);
      const attrs = [
        el.name, el.id, el.placeholder, el.ariaLabel,
        el.getAttribute("aria-label"),
        labelText(el)
      ].map(norm).filter(Boolean);

      // direct match or contains
      return attrs.some(a => a === k || a.includes(k));
    }

    // For each field requested, try to find the best element
    for (const [key, value] of Object.entries(fields || {})) {
      const candidates = inputs.filter(el => matches(el, key));
      let set = false;

      if (candidates.length) {
        const el = candidates[0];

        try {
          if (el.tagName === "SELECT") {
            const val = value.toString();
            // try by value first
            const optByVal = Array.from(el.options).find(o => o.value === val);
            // else try by text
            const optByText = Array.from(el.options).find(o => o.textContent.trim().toLowerCase() === val.toLowerCase());
            if (optByVal) el.value = optByVal.value;
            else if (optByText) el.value = optByText.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            set = true;
          } else if (el.type === "checkbox" || el.type === "radio") {
            const boolVal = !!value && `${value}`.toLowerCase() !== "false" && `${value}` !== "0";
            el.checked = boolVal;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            set = true;
          } else {
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            set = true;
          }

          if (set) results.filled.push({ key, by: descriptor(el) });
          else results.unmatched.push(key);
        } catch (error) {
          console.error('Error setting field value:', error);
          results.unmatched.push(key);
        }
      } else {
        results.unmatched.push(key);
      }
    }

    if (submit) {
      // Prefer form.submit via a submit button click to trigger handlers
      let submitted = false;

      // Look for a visible submit button
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn && submitBtn.offsetParent !== null) { // Check if visible
        submitBtn.click();
        submitted = true;
      } else {
        // Fallback: find closest form and submit()
        const anyFilledSelector = results.filled.length
          ? toSelectorFromDescriptor(results.filled[0].by)
          : null;
        let form = null;
        if (anyFilledSelector) {
          const el = document.querySelector(anyFilledSelector);
          form = el ? el.closest("form") : null;
        }
        if (!form) form = document.querySelector("form");
        if (form) {
          const evt = new Event("submit", { bubbles: true, cancelable: true });
          if (!form.dispatchEvent(evt)) {
            // prevented; try direct submit
            form.submit();
          }
          submitted = true;
        }
      }
      results.submitted = submitted;
    }

    return results;
  } catch (error) {
    console.error('Error in fillForm:', error);
    return { filled: [], unmatched: Object.keys(fields || {}), submitted: false, error: error.message };
  }

  // --- helpers
  function descriptor(el) {
    // Return a lightweight descriptor for reporting
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.name || null,
      placeholder: el.placeholder || null
    };
  }
  function toSelectorFromDescriptor(d) {
    if (!d) return null;
    if (d.id) return `#${CSS.escape(d.id)}`;
    if (d.name) return `[name="${CSS.escape(d.name)}"]`;
    return `${d.tag}[placeholder="${d.placeholder ? CSS.escape(d.placeholder) : ""}"]`;
  }
}

// Message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg?.action === "ping") {
      // Respond to ping to confirm content script is loaded
      sendResponse({ ok: true, status: "ready" });
    } else if (msg?.action === "getPageText") {
      const text = getPageText();
      sendResponse({ ok: true, text: text, url: location.href });
    } else if (msg?.action === "fillForm") {
      const { fields, submit } = msg.payload || {};
      try {
        const result = fillForm(fields || {}, !!submit);
        sendResponse({ ok: true, result });
      } catch (e) {
        console.error('Error in fillForm handler:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    } else {
      // Unknown action, but don't error
      sendResponse({ ok: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    sendResponse({ ok: false, error: error.message });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

// Log that content script has loaded
console.log('AI Browser Copilot content script loaded on:', location.href);