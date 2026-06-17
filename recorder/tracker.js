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

  function escapeForSelector(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function textIsProbablyStable(text) {
    if (!text || text.length < 2 || text.length > 60) return false;
    if (/\d{4}/.test(text)) return false;
    if (/^\d+$/.test(text)) return false;
    if (/[<>{}[\]|\\^`]/.test(text)) return false;
    return true;
  }

  function getCssPath(el) {
    if (!(el instanceof Element)) return null;

    if (el.id) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${escapeForSelector(testId)}"]`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${escapeForSelector(name)}"]`;
    const aria = el.getAttribute('aria-label');
    if (aria) return `${el.tagName.toLowerCase()}[aria-label="${escapeForSelector(aria)}"]`;

    const tag = el.tagName.toLowerCase();
    if (['button', 'a'].includes(tag)) {
      const text = (el.innerText || '').trim();
      if (textIsProbablyStable(text)) {
        return `${tag}:has-text("${escapeForSelector(text)}")`;
      }
    }

    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      if (cur.id) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
      const tid = cur.getAttribute('data-testid');
      if (tid) { parts.unshift(`[data-testid="${escapeForSelector(tid)}"]`); break; }
      const n = cur.getAttribute('name');
      if (n) { parts.unshift(`${cur.tagName.toLowerCase()}[name="${escapeForSelector(n)}"]`); break; }

      let nth = 1, sib = cur.previousElementSibling;
      while (sib) {
        if (sib.nodeName === cur.nodeName) nth++;
        sib = sib.previousElementSibling;
      }
      const seg = nth === 1
        ? cur.nodeName.toLowerCase()
        : `${cur.nodeName.toLowerCase()}:nth-of-type(${nth})`;
      parts.unshift(seg);
      cur = cur.parentElement;

      if (parts.length >= 5) break;
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

    // 1. aria-label trên chính element
    const aria = el.getAttribute('aria-label');
    if (aria) return normalizeText(aria);

    // 2. label[for=id]
    const forLabel = findLabelByFor(el);
    if (forLabel) return forLabel;

    // 3. label gần nhất trong form group
    const nearest = findNearestLabel(el);
    if (nearest) return nearest;

    // 4. placeholder / title
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return normalizeText(placeholder);
    const title = el.getAttribute('title');
    if (title) return normalizeText(title);

    // 5. innerText cho các tag thông thường
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'span', 'div', 'li'].includes(tag)) {
      const text = (el.innerText || '').trim();
      if (text) return normalizeText(text);
    }

    // ── FIX: icon-only button ──────────────────────────────────────────────────

    // 6. SVG con có class icon-tabler-* → lấy tên icon làm label
    //    vd: class="icon icon-tabler-user-plus" → "user-plus"
    if (['button', 'a'].includes(tag)) {
      const svgEl = el.querySelector('svg[class*="icon-tabler-"]');
      if (svgEl) {
        const match = (svgEl.getAttribute('class') || '').match(/icon-tabler-([\w-]+)/);
        if (match) return match[1];
      }

      // 7. title element bên trong SVG con
      const svgTitle = el.querySelector('svg title');
      if (svgTitle && svgTitle.textContent.trim()) {
        return normalizeText(svgTitle.textContent);
      }

      // 8. Leo ancestor tối đa 3 cấp tìm aria-label / title
      //    (dùng cho wrapper Mantine ActionIcon không có aria-label trực tiếp)
      let cur = el.parentElement;
      let depth = 0;
      while (cur && depth < 3) {
        const parentAria = cur.getAttribute('aria-label');
        if (parentAria) return normalizeText(parentAria);
        const parentTitle = cur.getAttribute('title');
        if (parentTitle) return normalizeText(parentTitle);
        cur = cur.parentElement;
        depth++;
      }
    }

    // ── END FIX ───────────────────────────────────────────────────────────────

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

  // ─── Frame cache ─────────────────────────────────────────────────────────────

  const CLICK_FRAME_WINDOW_MS = 500;
  const clickFrameMap = new Map();
  let pendingInputFrame = null;

  document.addEventListener('mousedown', (e) => {
    if (!window.__getLastFrame) return;
    const ts = Date.now();
    const entry = { frame: null, resolved: false };
    clickFrameMap.set(ts, entry);

    window.__getLastFrame()
      .then(b => { entry.frame = b; entry.resolved = true; })
      .catch(() => { entry.resolved = true; });

    for (const [key] of clickFrameMap) {
      if (ts - key > CLICK_FRAME_WINDOW_MS * 2) clickFrameMap.delete(key);
    }
  }, true);

  function consumeBestClickFrame() {
    const now = Date.now();
    let bestKey = null;
    for (const [key] of clickFrameMap) {
      if (now - key <= CLICK_FRAME_WINDOW_MS) {
        if (bestKey === null || key > bestKey) bestKey = key;
      }
    }
    if (bestKey === null) return null;
    const entry = clickFrameMap.get(bestKey);
    clickFrameMap.delete(bestKey);
    return entry.frame;
  }

  // ─── Send helpers ─────────────────────────────────────────────────────────────

  function sendWithFrame(action, frameBase64) {
    if (!action || !window.__recordManualDocAction) return;
    window.__recordManualDocAction(action, frameBase64 ?? null);
  }

  async function sendFetch(action) {
    if (!action || !window.__recordManualDocAction) return;
    let frame = null;
    try {
      if (window.__getLastFrame) frame = await window.__getLastFrame();
    } catch (_) {}
    window.__recordManualDocAction(action, frame);
  }

  // ─── Event listeners ────────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    const resolved = resolveClickTarget(e.target);
    if (!resolved) return;
    const action = buildAction('click', resolved, {
      mouse: { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    });
    const frame = consumeBestClickFrame();
    sendWithFrame(action, frame);
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!isInputLike(el)) return;
    const action = buildAction(el.tagName.toLowerCase() === 'select' ? 'select' : 'input', el);
    sendFetch(action);
  }, true);

  let lastInputTimer = null;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!isInputLike(el)) return;

    if (window.__getLastFrame) {
      window.__getLastFrame().then(b => { pendingInputFrame = b; }).catch(() => {});
    }

    clearTimeout(lastInputTimer);
    lastInputTimer = setTimeout(() => {
      const action = buildAction('input', el);
      const frame = pendingInputFrame;
      pendingInputFrame = null;
      sendWithFrame(action, frame);
    }, 600);
  }, true);

  document.addEventListener('submit', (e) => {
    const action = buildAction('submit', e.target);
    sendFetch(action);
  }, true);

  // ─── Scroll tracking ────────────────────────────────────────────────────────

  const SCROLL_THRESHOLD_PX = 100;
  const SCROLL_DEBOUNCE_MS = 400;

  let lastScrollY = window.scrollY;
  let lastScrollX = window.scrollX;
  let scrollTimer = null;

  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(async () => {
      const currentX = Math.round(window.scrollX);
      const currentY = Math.round(window.scrollY);
      const deltaX = Math.abs(currentX - lastScrollX);
      const deltaY = Math.abs(currentY - lastScrollY);

      if (deltaX < SCROLL_THRESHOLD_PX && deltaY < SCROLL_THRESHOLD_PX) return;

      lastScrollX = currentX;
      lastScrollY = currentY;

      let frame = null;
      try {
        if (window.__getLastFrame) frame = await window.__getLastFrame();
      } catch (_) {}

      const action = {
        event: 'scroll',
        page: { url: location.href, title: document.title },
        element: {
          tag: 'window',
          role: 'scroll',
          type: null,
          label: `scroll to (${currentX}, ${currentY})`,
          selector: null,
          pixel: null,
        },
        scrollX: currentX,
        scrollY: currentY,
        value: null,
        recordedAt: now(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };

      if (window.__recordManualDocAction) {
        window.__recordManualDocAction(action, frame);
      }
    }, SCROLL_DEBOUNCE_MS);
  }, { passive: true });

})();