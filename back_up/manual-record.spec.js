const { test, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
const HIGHLIGHT_DIR = path.join(OUTPUT_DIR, 'highlighted');
const TRACKER_PATH = path.resolve(__dirname, './tracker.js');

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
  const svg = `
    <svg width="${viewport.width}" height="${viewport.height}">
      <rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"
        fill="rgba(255,0,0,0.08)" stroke="red" stroke-width="3" rx="3"/>
    </svg>
  `;
  await sharp(inputPath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toFile(outputPath);
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
    default:
      return null;
  }
}

// ─── Screencast manager ───────────────────────────────────────────────────────
//
// Thay vì chụp ảnh theo yêu cầu (pull), ta stream liên tục (push) mỗi khi
// Chrome render xong 1 frame. Frame mới nhất luôn được lưu trong lastFrame.
//
// Khi action xảy ra → lấy lastFrame ra dùng NGAY, synchronous, không async.
// Navigation không ảnh hưởng vì frame đã nằm sẵn trong RAM trước đó rồi.

class ScreencastManager {
  constructor() {
    // page → { cdp, lastFrame: Buffer | null }
    this._sessions = new Map();
  }

  async attach(page) {
    if (this._sessions.has(page)) return;

    let cdp;
    try {
      cdp = await page.context().newCDPSession(page);
    } catch (e) {
      console.warn('CDP attach failed:', e.message);
      return;
    }

    const entry = { cdp, lastFrame: null };
    this._sessions.set(page, entry);

    // Nhận frame liên tục, lưu frame mới nhất
    cdp.on('Page.screencastFrame', async (event) => {
      entry.lastFrame = Buffer.from(event.data, 'base64');
      // Phải ACK để Chrome gửi frame tiếp
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
      } catch (_) {}
    });

    // Bắt đầu screencast: quality 80, tối đa 10fps (đủ để capture mọi action)
    try {
      await cdp.send('Page.startScreencast', {
        format: 'png',
        quality: 80,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 1,
      });
    } catch (e) {
      console.warn('startScreencast failed:', e.message);
    }

    page.on('close', () => this._detach(page));

    // Khi navigate sang page mới, screencast tự reset —
    // Chrome tiếp tục gửi frame của page mới vào cùng session
  }

  async _detach(page) {
    const entry = this._sessions.get(page);
    if (!entry) return;
    try { await entry.cdp.send('Page.stopScreencast'); } catch (_) {}
    this._sessions.delete(page);
  }

  // Lấy frame mới nhất của page hiện tại — SYNCHRONOUS, không async
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

  // Attach screencast cho mọi page mới (popup, tab mới)
  context.on('page', (page) => screencast.attach(page));

  // ── Expose: lấy frame mới nhất từ RAM ─────────────────────────────────────
  // Hàm này KHÔNG async thực sự — frame đã có sẵn trong RAM, chỉ cần serialize.
  // Browser await nó để đồng bộ hóa, nhưng nó resolve gần như ngay lập tức
  // trước khi bất kỳ navigation nào có cơ hội xảy ra.
  await context.exposeFunction('__getLastFrame', () => {
    const pages = context.pages();
    const page = pages[pages.length - 1];
    if (!page || page.isClosed()) return null;

    const frame = screencast.getLastFrame(page);
    if (!frame) return null;

    return frame.toString('base64');
  });

  // ── Xử lý action + ghi file ───────────────────────────────────────────────
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

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'actions.raw.json'),
      JSON.stringify(actions, null, 2),
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
    actionQueue = actionQueue.then(() => processAction(rawAction, screenshotBase64));
  });

  await context.addInitScript({ path: TRACKER_PATH });

  const page = await context.newPage();

  // Attach screencast cho page đầu tiên (context 'page' event không fire cho cái này)
  await screencast.attach(page);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Chờ một chút để screencast bắt đầu nhận frame
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n====================================');
  console.log('Manual recorder is running.');
  console.log('Thao tác trong browser vừa mở.');
  console.log('Xong thì nhấn Resume trong Playwright Inspector.');
  console.log(`Output: ${OUTPUT_DIR}/actions.raw.json`);
  console.log('====================================\n');

  await page.pause();
  await actionQueue;

  // ── Xuất recorded.spec.js ──────────────────────────────────────────────────
  const playwrightLines = actions
    .filter((a) => a.playwrightAction)
    .filter((a, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return !(a.playwrightAction === prev.playwrightAction && a.event === prev.event);
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
  await context.tracing.stop({ path: path.join(OUTPUT_DIR, 'trace.zip') });
  await context.close();
  await browser.close();
});