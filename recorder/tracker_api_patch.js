/**
 * tracker_api_patch.js
 *
 * Patch nhỏ — inject vào cuối tracker.js (hoặc dùng thay thế sendFetch).
 * Thay vì ghi file JSON trực tiếp, gọi POST http://localhost:8000/compile
 * sau mỗi action để FastAPI sinh .docx + .pdf.
 *
 * Cách dùng trong manual-record.spec.js:
 *   await context.addInitScript({ path: TRACKER_PATH });
 *   await context.addInitScript({ path: path.resolve(__dirname, './tracker_api_patch.js') });
 */

(() => {
  const API_BASE = (typeof process !== 'undefined' && process.env.API_BASE)
    ? process.env.API_BASE
    : 'http://localhost:8000';

  // ── Job polling ─────────────────────────────────────────────────────────

  async function pollJob(jobId, maxWaitMs = 30_000, intervalMs = 800) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      try {
        const res  = await fetch(`${API_BASE}/status/${jobId}`);
        const data = await res.json();
        if (data.status === 'done') {
          console.log('[tracker-api] Compile done:', data.download_urls);
          return data;
        }
        if (data.status === 'error') {
          console.error('[tracker-api] Compile error:', data.error);
          return data;
        }
      } catch (_) { /* network hiccup — retry */ }
    }
    console.warn('[tracker-api] pollJob timeout:', jobId);
    return null;
  }

  // ── Main compile trigger ─────────────────────────────────────────────────

  /**
   * Gọi POST /compile với ai_output.
   * @param {string} aiOutput  — chuỗi text từ AI (bước + nội dung)
   * @param {string} [prefix]  — tiền tố tên file, mặc định "HUONG_DAN_SU_DUNG"
   * @returns {Promise<{job_id: string, download_urls: string[]} | null>}
   */
  window.__compileDoc = async function compileDoc(aiOutput, prefix = 'HUONG_DAN_SU_DUNG') {
    if (!aiOutput || !aiOutput.trim()) {
      console.warn('[tracker-api] __compileDoc: aiOutput rỗng, bỏ qua.');
      return null;
    }

    let jobId;
    try {
      const res = await fetch(`${API_BASE}/compile`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ai_output: aiOutput, filename_prefix: prefix }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[tracker-api] /compile HTTP error:', res.status, err);
        return null;
      }

      const data = await res.json();
      jobId = data.job_id;
      console.log('[tracker-api] Job created:', jobId);
    } catch (e) {
      console.error('[tracker-api] fetch /compile failed:', e.message);
      return null;
    }

    return pollJob(jobId);
  };

  // ── Health check on load ─────────────────────────────────────────────────

  fetch(`${API_BASE}/health`)
    .then(r => r.json())
    .then(d => console.log('[tracker-api] API health:', d.status))
    .catch(() => console.warn('[tracker-api] API không sẵn sàng tại', API_BASE));

})();