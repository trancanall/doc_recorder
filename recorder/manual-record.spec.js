    require('dotenv').config();
    
  const { test, chromium } = require('@playwright/test');
  const fs = require('fs');
  const path = require('path');
  const sharp = require('sharp');

  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const OUTPUT_DIR = path.resolve(__dirname, '../output');
  const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
  const HIGHLIGHT_DIR = path.join(OUTPUT_DIR, 'highlighted');
  const TRACKER_PATH = path.resolve(__dirname, './tracker.js');
const readline = require('readline');
  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function isValidPixel(pixel, viewport) {
    if (!Array.isArray(pixel) || pixel.length !== 4) return false;
    const [x1, y1, x2, y2] = pixel;
    return (
      Number.isFinite(x1) && Number.isFinite(y1) &&
      Number.isFinite(x2) && Number.isFinite(y2) &&
      0 <= x1 && x1 < x2 && x2 <= viewport.width &&
      0 <= y1 && y1 < y2 && y2 <= viewport.height
    );
  }

  async function drawHighlight(inputPath, outputPath, pixel, viewport) {
    const [x1, y1, x2, y2] = pixel;

    // Padding 12px để rect không bao sát element — trông như highlight thay vì border
    const PAD = 12;
    const hx = Math.max(x1 - PAD, 0);
    const hy = Math.max(y1 - PAD, 0);
    const hw = Math.min(x2 + PAD, viewport.width) - hx;
    const hh = Math.min(y2 + PAD, viewport.height) - hy;

    const svg = `
      <svg width="${viewport.width}" height="${viewport.height}">
        <rect x="${hx}" y="${hy}" width="${hw}" height="${hh}"
          fill="rgba(255, 200, 0, 0.15)"
          stroke="rgba(255, 160, 0, 0.9)"
          stroke-width="2"
          stroke-dasharray="6 3"
          rx="8"/>
      </svg>
    `;
    await sharp(inputPath)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .toFile(outputPath);
  }
  // Thay promptSessionMeta() bằng cái này
async function promptSessionMeta(page) {
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Manual Recorder</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: #f5f5f5;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
        }
        .card {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 28px 32px;
          width: 420px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .icon-wrap {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: #eef2ff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }
        .title {
          font-size: 15px;
          font-weight: 600;
          color: #111827;
        }
        .subtitle {
          font-size: 13px;
          color: #6b7280;
          margin-top: 2px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .field label {
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .field input {
          width: 100%;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 14px;
          color: #111827;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field input:focus {
          border-color: #a5b4fc;
          box-shadow: 0 0 0 3px rgba(165,180,252,0.25);
        }
        .field input::placeholder { color: #9ca3af; }
        button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #534AB7;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          width: 100%;
        }
        button:hover { background: #3C3489; }
        button:active { transform: scale(0.98); }
        button:disabled { opacity: 0.5; cursor: default; }
        .success {
          display: none;
          align-items: center;
          gap: 10px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          color: #166534;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div class="icon-wrap">🎬</div>
          <div>
            <div class="title">Manual Recorder</div>
            <div class="subtitle">Điền thông tin trước khi bắt đầu</div>
          </div>
        </div>

        <div class="field">
          <label> Luồng đang record</label>
          <input id="task" placeholder="vd: tạo đơn nhập kho" autofocus />
        </div>

        <div class="field">
          <label> Role người dùng</label>
          <input id="role" placeholder="vd: admin, kế toán, user..." />
        </div>

        <div class="success" id="success">
           <span id="success-msg"></span>
        </div>

        <button id="btn">▶ Bắt đầu record</button>
      </div>

      <script>
        function start() {
          const task = document.getElementById('task').value.trim() || 'Chưa đặt tên';
          const role = document.getElementById('role').value.trim() || 'user';
          window.__sessionMeta = { taskName: task, role };
          const s = document.getElementById('success');
          document.getElementById('success-msg').textContent = 'Đang record "' + task + '" — role: ' + role;
          s.style.display = 'flex';
          const btn = document.getElementById('btn');
          btn.disabled = true;
        }
        document.getElementById('btn').onclick = start;
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') document.getElementById('btn').click();
        });
      </script>
    </body>
    </html>
  `);

  // Đợi người dùng bấm "Bắt đầu record"
  await page.waitForFunction(() => window.__sessionMeta != null, { timeout: 0 });

  const meta = await page.evaluate(() => window.__sessionMeta);
  console.log(`\n  Luồng: ${meta.taskName}`);
  console.log(`  Role:  ${meta.role}\n`);

  return { ...meta, recordedAt: new Date().toISOString() };
}
  

  function derivePlaywrightAction(action) {
    const sel = action.element?.selector;
    const val = action.value;
    const label = action.element?.label || '';
    const comment = label ? ` // ${label}` : '';

    switch (action.event) {
      case 'click':
        return `await page.click('${sel}');${comment}`;
      case 'input':
      case 'change':
        if (action.element?.role === 'password')
          return `await page.fill('${sel}', process.env.PASSWORD ?? '');${comment}`;
        return `await page.fill('${sel}', ${JSON.stringify(val)});${comment}`;
      case 'select':
        return `await page.selectOption('${sel}', { label: ${JSON.stringify(val)} });${comment}`;
      case 'submit':
        return `await page.waitForURL('**'); // after submit`;
      // FIX #8: scroll action
      case 'scroll':
        return `await page.evaluate(() => window.scrollTo(${action.scrollX ?? 0}, ${action.scrollY ?? 0}));${comment}`;
      default:
        return null;
    }
  }

  // ─── ScreencastManager ────────────────────────────────────────────────────────
  //
  // FIX #2: Detect CDP session disconnect và tự re-attach.
  // FIX #3: attach() trả về Promise nhưng context.on('page') không await được —
  //         dùng internal async init, expose getLastFrame chỉ sau khi ready.

  const SCREENCAST_PARAMS = {
    format: 'png',
    quality: 80,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  };

  const CDP_RESTART_DELAY_MS = 300;
  const CDP_MAX_RETRIES = 3;

  class ScreencastManager {
    constructor() {
      // page → { cdp, lastFrame: Buffer | null, restarting: boolean, retries: number }
      this._sessions = new Map();
    }

    // Trả về ngay, init chạy async bên trong
    // FIX #3: caller không cần await — safe để dùng trong context.on('page')
    attach(page) {
      if (this._sessions.has(page)) return;
      // Placeholder ngay để tránh double-attach nếu event fire 2 lần
      this._sessions.set(page, { cdp: null, lastFrame: null, restarting: false, retries: 0 });
      this._initSession(page).catch(err =>
        console.warn('[Screencast] init failed:', err.message)
      );
    }

    async _initSession(page, retryCount = 0) {
      if (page.isClosed()) return;

      let cdp;
      try {
        cdp = await page.context().newCDPSession(page);
      } catch (e) {
        console.warn('[Screencast] CDP attach failed:', e.message);
        this._sessions.delete(page);
        return;
      }

      const entry = { cdp, lastFrame: null, restarting: false, retries: retryCount };
      this._sessions.set(page, entry);

      cdp.on('Page.screencastFrame', async (event) => {
        entry.lastFrame = Buffer.from(event.data, 'base64');
        try {
          await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
        } catch (_) {}
      });

      // FIX #1 (original): restart screencast sau mỗi main-frame navigation
      page.on('framenavigated', async (frame) => {
        if (frame.parentFrame()) return;
        if (entry.restarting) return;
        entry.restarting = true;
        try {
          await cdp.send('Page.stopScreencast');
          await cdp.send('Page.startScreencast', SCREENCAST_PARAMS);
        } catch (_) {}
        finally { entry.restarting = false; }
      });

      // FIX #2: CDP session die → re-create với exponential backoff
      cdp.on('disconnect', () => {
        if (page.isClosed()) return;
        entry.lastFrame = null; // không dùng frame stale

        const nextRetry = retryCount + 1;
        if (nextRetry > CDP_MAX_RETRIES) {
          console.warn(`[Screencast] CDP disconnected, max retries (${CDP_MAX_RETRIES}) reached`);
          return;
        }

        const delay = CDP_RESTART_DELAY_MS * Math.pow(2, retryCount); // 300, 600, 1200ms
        console.warn(`[Screencast] CDP disconnected, retry ${nextRetry}/${CDP_MAX_RETRIES} in ${delay}ms`);
        setTimeout(() => {
          this._initSession(page, nextRetry).catch(() => {});
        }, delay);
      });

      try {
        await cdp.send('Page.startScreencast', SCREENCAST_PARAMS);
      } catch (e) {
        console.warn('[Screencast] startScreencast failed:', e.message);
      }

      page.on('close', () => this._detach(page));
    }

    async _detach(page) {
      const entry = this._sessions.get(page);
      if (!entry) return;
      try { await entry.cdp?.send('Page.stopScreencast'); } catch (_) {}
      this._sessions.delete(page);
    }

    getLastFrame(page) {
      return this._sessions.get(page)?.lastFrame ?? null;
    }

    async detachAll() {
      for (const [page] of this._sessions) {
        await this._detach(page);
      }
    }
  }

  // ─── Main ─────────────────────────────────────────────────────────────────────

test('manual document recorder', async () => {
  ensureDir(OUTPUT_DIR);
  ensureDir(SCREENSHOT_DIR);
  ensureDir(HIGHLIGHT_DIR);

  const actions = [];
  let stepCounter = 0;

  let actionQueue = Promise.resolve();
  function enqueue(fn) {
    actionQueue = actionQueue
      .then(fn)
      .catch(err => console.error('[Queue] processAction error:', err));
  }

  const screencast = new ScreencastManager();

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1280,720'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: path.join(OUTPUT_DIR, 'videos'),
      size: { width: 1280, height: 720 },
    },
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  context.on('page', (page) => {
    screencast.attach(page);
  });

  // ── Mở trang meta trước, chưa load tracker ──
  const page = await context.newPage();
  screencast.attach(page);
  const sessionMeta = await promptSessionMeta(page);

  // ── Gắn functions + tracker SAU khi có meta, TRƯỚC khi goto app ──
  await context.exposeFunction('__getLastFrame', () => {
    const pages = context.pages();
    const pg = pages[pages.length - 1];
    if (!pg || pg.isClosed()) return null;
    const frame = screencast.getLastFrame(pg);
    return frame ? frame.toString('base64') : null;
  });

  async function processAction(rawAction, screenshotBase64) {
    stepCounter++;
    const action = { step: stepCounter, ...rawAction };
    const viewport = action.viewport || { width: 1280, height: 720 };
    const pixel = action.element?.pixel;

    if (!isValidPixel(pixel, viewport)) action.warning = 'INVALID_PIXEL';

    const pad = String(stepCounter).padStart(3, '0');
    const screenshotName = `step_${pad}.png`;
    const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
    const highlightedName = `step_${pad}_highlight.png`;
    const highlightedPath = path.join(HIGHLIGHT_DIR, highlightedName);

    if (screenshotBase64) {
      try {
        fs.writeFileSync(screenshotPath, Buffer.from(screenshotBase64, 'base64'));
        action.screenshot = `screenshots/${screenshotName}`;
        if (!action.warning) {
          await drawHighlight(screenshotPath, highlightedPath, pixel, viewport);
          action.highlightedScreenshot = `highlighted/${highlightedName}`;
        }
      } catch (err) {
        action.screenshotError = err.message;
      }
    } else {
      action.screenshotError = 'No frame available';
    }

    action.playwrightAction = derivePlaywrightAction(action);
    actions.push(action);

    await fs.promises.writeFile(
      path.join(OUTPUT_DIR, 'actions.raw.json'),
      JSON.stringify({ sessionMeta, actions }, null, 2),
      'utf-8'
    );

    console.log(`✓ Step ${stepCounter}:`, {
      event: action.event,
      label: action.element?.label,
      selector: action.element?.selector,
      hasScreenshot: !!screenshotBase64,
    });
  }

  await context.exposeFunction('__recordManualDocAction', (rawAction, screenshotBase64) => {
    enqueue(() => processAction(rawAction, screenshotBase64));
  });

  await context.addInitScript({ path: TRACKER_PATH });

  // ── Giờ mới vào app thật ──
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n====================================');
  console.log('Manual recorder is running.');
  console.log('Thao tác trong browser vừa mở.');
  console.log('Xong thì nhấn Resume trong Playwright Inspector.');
  console.log(`Output: ${OUTPUT_DIR}/actions.raw.json`);
  console.log('====================================\n');

  try {
    await page.pause();
  } catch (e) {
    console.log('\nBrowser closed manually, flushing remaining actions...');
  }

  await actionQueue.catch(() => {});

  const playwrightLines = actions
    .filter((a) => a.playwrightAction)
    .filter((a, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return !(
        a.playwrightAction === prev.playwrightAction &&
        a.event === prev.event &&
        a.page?.url === prev.page?.url
      );
    })
    .map((a) => `  ${a.playwrightAction}`);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'recorded.spec.js'),
    `// Auto-generated from manual recording\n// Review selectors/values before running.\n\nconst { test, expect } = require('@playwright/test');\n\ntest('recorded flow', async ({ page }) => {\n  await page.goto('${BASE_URL}');\n\n${playwrightLines.join('\n')}\n});\n`,
    'utf-8'
  );

  console.log('\n✓ Saved: actions.raw.json');
  console.log('✓ Saved: recorded.spec.js');

  await screencast.detachAll();

  try {
    await context.tracing.stop({ path: path.join(OUTPUT_DIR, 'trace.zip') });
  } catch (_) {}

  try { await context.close(); } catch (_) {}
  try { await browser.close(); } catch (_) {}
});