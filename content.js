// Adds a "Copy cleaned transcript" button to YouTube's transcript panel.
(function () {
  const BUTTON_ID = 'ytc-copy-transcript-btn';
  const CONTAINER_ID = 'ytc-copy-transcript-container';
  const RESET_DELAY_MS = 1800;

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function getTranscriptPanel() {
    const panel = document.querySelector('ytd-transcript-renderer');
    return panel && isVisible(panel) ? panel : null;
  }

  function cleanSegmentText(raw) {
    if (!raw) return '';
    let text = raw.replace(/\s+/g, ' ').trim();
    // Safety net in case a timestamp is embedded in the text node itself.
    text = text.replace(/^\d{1,2}(:\d{2}){1,2}\s*/, '');
    return text;
  }

  function extractSegmentTexts(panel) {
    const segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
    const texts = [];
    segments.forEach((segment) => {
      const textEl = segment.querySelector('.segment-text');
      const raw = textEl ? textEl.textContent : segment.textContent;
      const cleaned = cleanSegmentText(raw);
      if (cleaned) texts.push(cleaned);
    });
    return texts;
  }

  function buildCleanedTranscript(panel) {
    const joined = extractSegmentTexts(panel).join(' ');
    return joined
      .replace(/\s+/g, ' ')
      .trim()
      // Re-space sentences that got glued together across segment breaks.
      .replace(/([.?!])(?=[A-Za-z0-9])/g, '$1 ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch (fallbackErr) {
        console.error('YouTube Transcript Cleaner: copy failed', fallbackErr);
        return false;
      }
    }
  }

  function flashButtonState(btn, label, isError) {
    btn.textContent = label;
    btn.classList.toggle('ytc-error', !!isError);
    btn.classList.toggle('ytc-copied', !isError);
    setTimeout(() => {
      btn.textContent = 'Copy cleaned transcript';
      btn.classList.remove('ytc-copied', 'ytc-error');
    }, RESET_DELAY_MS);
  }

  function createButton(panel) {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = 'Copy cleaned transcript';

    btn.addEventListener('click', async () => {
      const currentPanel = getTranscriptPanel();
      if (!currentPanel) return;

      const text = buildCleanedTranscript(currentPanel);
      if (!text) {
        flashButtonState(btn, 'No transcript found', true);
        return;
      }

      const ok = await copyToClipboard(text);
      flashButtonState(btn, ok ? 'Copied!' : 'Copy failed', !ok);
    });

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.appendChild(btn);

    const header = panel.querySelector('#header') || panel;
    header.insertAdjacentElement('afterend', container);
  }

  function removeButton() {
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.remove();
  }

  function checkForTranscriptPanel() {
    const panel = getTranscriptPanel();
    if (panel) {
      createButton(panel);
    } else {
      removeButton();
    }
  }

  let debounceTimer = null;
  function scheduleCheck() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      checkForTranscriptPanel();
    }, 150);
  }

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    removeButton();
    setTimeout(checkForTranscriptPanel, 500);
  });

  checkForTranscriptPanel();
})();
