"""
gen_huong_dan_su_dung.py
Gọi AI (Claude / OpenAI) để sinh ai_output từ actions.raw.json,
sau đó POST lên FastAPI /compile.

Chạy:
  python gen_huong_dan_su_dung.py
  python gen_huong_dan_su_dung.py --actions output/actions.raw.json --api http://localhost:8000
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("⚠️  Thiếu requests: pip install requests")
    raise

# ── Config ───────────────────────────────────────────────────────────────────
OUTPUT_DIR   = Path(os.getenv("OUTPUT_DIR", "./output"))
API_BASE     = os.getenv("API_BASE", "http://localhost:8000")
ACTIONS_FILE = OUTPUT_DIR / "actions.raw.json"

# ── Prompt builder ───────────────────────────────────────────────────────────

def build_prompt(actions_data: dict) -> str:
    meta    = actions_data.get("sessionMeta", {})
    actions = actions_data.get("actions", [])

    lines = [
        f"Luồng: {meta.get('taskName', 'N/A')}",
        f"Role: {meta.get('role', 'user')}",
        f"Recorded at: {meta.get('recordedAt', '')}",
        "",
        "Dưới đây là các action đã ghi lại. Hãy viết hướng dẫn sử dụng chi tiết theo từng bước (Bước 1:, Bước 2:, ...) dạng tiếng Việt, rõ ràng, dễ hiểu.",
        "Với mỗi bước, ghi rõ:",
        "- Mô tả hành động",
        "- Nếu có ảnh highlight: Hình ảnh minh họa: `<đường_dẫn>`",
        "- Nếu có pixel: Vị trí tương tác: [x1, y1, x2, y2]",
        "",
        "=== ACTIONS ===",
    ]

    for a in actions:
        step     = a.get("step", "?")
        event    = a.get("event", "")
        label    = a.get("element", {}).get("label", "")
        selector = a.get("element", {}).get("selector", "")
        value    = a.get("value", "")
        url      = a.get("page", {}).get("url", "")
        hl       = a.get("highlightedScreenshot", "")
        pixel    = a.get("element", {}).get("pixel", "")

        lines.append(f"Step {step}: event={event}, label={label!r}, selector={selector!r}, value={value!r}, url={url}")
        if hl:
            lines.append(f"  highlighted: {hl}")
        if pixel:
            lines.append(f"  pixel: {pixel}")

    return "\n".join(lines)


# ── Fake AI (placeholder — thay bằng OpenAI / Claude SDK thật) ───────────────

def call_ai(prompt: str) -> str:
    """
    Placeholder — trả về hướng dẫn mẫu để test pipeline.
    Thay hàm này bằng:
      import anthropic
      client = anthropic.Anthropic()
      msg = client.messages.create(model="claude-opus-4-5", max_tokens=4096, messages=[{"role":"user","content":prompt}])
      return msg.content[0].text
    """
    print("🤖 [AI] Đang generate hướng dẫn (placeholder)...")
    time.sleep(0.5)
    return """
Bước 1: Mở trang đăng nhập
Truy cập vào hệ thống. Nhập tên đăng nhập và mật khẩu vào các ô tương ứng.

Bước 2: Nhấn nút Đăng nhập
Sau khi điền đầy đủ thông tin, nhấn nút **Đăng nhập** để vào hệ thống.
> Nếu quên mật khẩu, nhấn "Quên mật khẩu" để đặt lại.

Bước 3: Chọn chức năng cần sử dụng
Trên menu chính, chọn chức năng phù hợp với công việc của bạn.
"""


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sinh hướng dẫn từ actions.raw.json")
    parser.add_argument("--actions", default=str(ACTIONS_FILE), help="Đường dẫn actions.raw.json")
    parser.add_argument("--api",     default=API_BASE,          help="URL FastAPI, mặc định http://localhost:8000")
    parser.add_argument("--prefix",  default="HUONG_DAN_SU_DUNG", help="Tiền tố tên file output")
    parser.add_argument("--no-send", action="store_true",       help="Chỉ sinh ai_output, không gọi /compile")
    args = parser.parse_args()

    actions_file = Path(args.actions)
    if not actions_file.exists():
        print(f"❌ Không tìm thấy: {actions_file}")
        return

    actions_data = json.loads(actions_file.read_text(encoding="utf-8"))
    prompt       = build_prompt(actions_data)
    ai_output    = call_ai(prompt)

    # Lưu ai_output để debug
    ai_out_file = OUTPUT_DIR / "ai_output.txt"
    ai_out_file.parent.mkdir(parents=True, exist_ok=True)
    ai_out_file.write_text(ai_output, encoding="utf-8")
    print(f"📝 Đã lưu ai_output: {ai_out_file}")

    if args.no_send:
        print("⏭️  --no-send: bỏ qua bước gọi /compile")
        return

    # Gọi FastAPI
    url = f"{args.api.rstrip('/')}/compile"
    print(f"📤 POST {url} ...")
    try:
        res = requests.post(url, json={"ai_output": ai_output, "filename_prefix": args.prefix}, timeout=10)
        res.raise_for_status()
        data = res.json()
        print(f"✅ Job created: {data['job_id']}")

        # Poll status
        status_url = f"{args.api.rstrip('/')}/status/{data['job_id']}"
        for _ in range(60):
            time.sleep(1)
            s = requests.get(status_url, timeout=5).json()
            print(f"   status: {s['status']}")
            if s["status"] in ("done", "error"):
                if s["status"] == "done":
                    print(f"🎉 Files: {s.get('download_urls', [])}")
                else:
                    print(f"❌ Error: {s.get('error')}")
                break

    except requests.RequestException as e:
        print(f"❌ Lỗi khi gọi API: {e}")


if __name__ == "__main__":
    main()