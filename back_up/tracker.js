(() => {
  if (window.__manualDocTrackerInstalled) return;
  window.__manualDocTrackerInstalled = true;

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function now() { return new Date().toISOString(); }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0
    );
  }

  function getBox(el) {
    const r = el.getBoundingClientRect();
    return [
      Math.max(0, Math.round(r.left)),
      Math.max(0, Math.round(r.top)),
      Math.min(window.innerWidth, Math.round(r.right)),
      Math.min(window.innerHeight, Math.round(r.bottom))
    ];
  }

  // ─── Selector ───────────────────────────────────────────────────────────────

  function getCssPath(el) {
    if (!(el instanceof Element)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const aria = el.getAttribute('aria-label');
    if (aria) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
    const tag = el.tagName.toLowerCase();
    if (['button', 'a'].includes(tag)) {
      const text = (el.innerText || '').trim().slice(0, 80);
      if (text) return `${tag}:has-text("${text}")`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      if (cur.id) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
      const tid = cur.getAttribute('data-testid');
      if (tid) { parts.unshift(`[data-testid="${CSS.escape(tid)}"]`); break; }
      const n = cur.getAttribute('name');
      if (n) { parts.unshift(`${cur.tagName.toLowerCase()}[name="${CSS.escape(n)}"]`); break; }
      let nth = 1, sib = cur.previousElementSibling;
      while (sib) { if (sib.nodeName === cur.nodeName) nth++; sib = sib.previousElementSibling; }
      parts.unshift(`${cur.nodeName.toLowerCase()}:nth-of-type(${nth})`);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ─── Label ──────────────────────────────────────────────────────────────────

  function findLabelByFor(el) {
    const id = el.getAttribute('id');
    if (!id) return null;
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    return label ? normalizeText(label.innerText) : null;
  }

  function findNearestLabel(el) {
    const direct = el.closest('label');
    if (direct) return normalizeText(direct.innerText);
    const group = el.closest('.form-group, .mb-3, .col, .col-md-6, .col-lg-6, .row, td, th');
    if (!group) return null;
    const label = group.querySelector('label');
    return label ? normalizeText(label.innerText) : null;
  }

  function getElementLabel(el) {
    if (!el) return null;
    const aria = el.getAttribute('aria-label');
    if (aria) return normalizeText(aria);
    const forLabel = findLabelByFor(el);
    if (forLabel) return forLabel;
    const nearest = findNearestLabel(el);
    if (nearest) return nearest;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return normalizeText(placeholder);
    const title = el.getAttribute('title');
    if (title) return normalizeText(title);
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'span', 'div', 'li'].includes(tag)) {
      const text = (el.innerText || '').trim();
      if (text) return normalizeText(text);
    }
    const name = el.getAttribute('name');
    if (name) return normalizeText(name);
    return el.tagName.toLowerCase();
  }

  function getElementRole(el) {
    return el.getAttribute('role') || el.getAttribute('type') || el.tagName.toLowerCase();
  }

  // ─── Input helpers ───────────────────────────────────────────────────────────

  function isInputLike(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    return (
      tag === 'input' || tag === 'textarea' || tag === 'select' ||
      el.isContentEditable ||
      ['text', 'email', 'password', 'number', 'date', 'search', 'tel'].includes(type)
    );
  }

  function getSafeValue(el) {
    if (!isInputLike(el)) return null;
    if ((el.getAttribute('type') || '').toLowerCase() === 'password') return '********';
    if (el.tagName.toLowerCase() === 'select') {
      const selected = el.options[el.selectedIndex];
      return selected ? normalizeText(selected.textContent) : normalizeText(el.value);
    }
    if (el.isContentEditable) return normalizeText(el.innerText);
    return normalizeText(el.value);
  }

  // ─── Decorative element filter ───────────────────────────────────────────────

  function isDecorativeElement(el) {
    const tag = el.tagName.toLowerCase();
    if (!['i', 'svg', 'path', 'circle', 'rect', 'polyline', 'line', 'use'].includes(tag)) return false;
    if (el.getAttribute('role')) return false;
    if (el.getAttribute('aria-label')) return false;
    if (el.getAttribute('data-testid')) return false;
    return true;
  }

  function resolveClickTarget(el) {
    if (!isDecorativeElement(el)) return el;
    let cur = el.parentElement, depth = 0;
    while (cur && depth < 5) {
      const tag = cur.tagName.toLowerCase();
      if (['button', 'a', 'input', 'select', 'textarea', 'label'].includes(tag)) return cur;
      if (cur.getAttribute('role')) return cur;
      if (cur.getAttribute('aria-label')) return cur;
      if (cur.getAttribute('data-testid')) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  // ─── Action builder ──────────────────────────────────────────────────────────

  function buildAction(eventType, el, extra = {}) {
    if (!el || !isVisible(el)) return null;
    const pixel = getBox(el);
    const [x1, y1, x2, y2] = pixel;
    if (x2 <= x1 || y2 <= y1) return null;
    return {
      event: eventType,
      page: { url: location.href, title: document.title },
      element: {
        tag: el.tagName.toLowerCase(),
        role: getElementRole(el),
        type: el.getAttribute('type'),
        label: getElementLabel(el),
        text: normalizeText(el.innerText),
        placeholder: normalizeText(el.getAttribute('placeholder')),
        name: normalizeText(el.getAttribute('name')),
        id: normalizeText(el.getAttribute('id')),
        selector: getCssPath(el),
        pixel
      },
      value: getSafeValue(el),
      recordedAt: now(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ...extra
    };
  }

  // ─── Send: lấy frame từ screencast buffer, KHÔNG cần async CDP call ──────────
  //
  // __getLastFrame() trả về base64 của frame cuối cùng mà screencast đã push
  // vào RAM ở Node side. Frame này luôn tồn tại từ trước khi action xảy ra.
  //
  // Vì __getLastFrame là exposeFunction, browser vẫn phải await nó —
  // điều này tạo ra 1 micro-delay đủ để chắc chắn frame đã được set trước đó,
  // nhưng KHÔNG đủ để navigation xảy ra (navigation cần user-gesture + JS stack clear).
  //
  // Sau khi await xong → gọi __recordManualDocAction() — lúc này navigation
  // mới có thể xảy ra, nhưng ta đã có frame rồi nên không quan trọng.

  async function send(action) {
    if (!action) return;
    if (!window.__getLastFrame || !window.__recordManualDocAction) return;

    try {
      const screenshotBase64 = await window.__getLastFrame();
      window.__recordManualDocAction(action, screenshotBase64);
    } catch (e) {
      window.__recordManualDocAction(action, null);
    }
  }

  // ─── Event listeners ────────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    const resolved = resolveClickTarget(e.target);
    if (!resolved) return;
    const action = buildAction('click', resolved, {
      mouse: { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    });
    send(action);
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!isInputLike(el)) return;
    send(buildAction(el.tagName.toLowerCase() === 'select' ? 'select' : 'input', el));
  }, true);

  let lastInputTimer = null;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isInputLike(el)) return;
    clearTimeout(lastInputTimer);
    lastInputTimer = setTimeout(() => send(buildAction('input', el)), 600);
  }, true);

  document.addEventListener('submit', (e) => {
    send(buildAction('submit', e.target));
  }, true);
})();