"""
compile_and_pdf.py
Sinh .md rồi compile thành .pdf từ AI_OUTPUT.

Chạy standalone:
  python compile_and_pdf.py

Gọi từ FastAPI:
  from compile_and_pdf import build_md, build_pdf_from_md
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer

# ── Paths ────────────────────────────────────────────────────────────────────
_OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", Path(__file__).parent / "output"))

AI_OUTPUT = ""  # dùng khi chạy standalone


# ── Font registration ────────────────────────────────────────────────────────

def register_vietnamese_font() -> tuple[str, str, str]:
    candidates = [
        {
            "regular_name": "TimesNewRoman",
            "bold_name":    "TimesNewRoman-Bold",
            "mono_name":    "CourierNew",
            "regular_path": r"C:\Windows\Fonts\times.ttf",
            "bold_path":    r"C:\Windows\Fonts\timesbd.ttf",
            "mono_path":    r"C:\Windows\Fonts\cour.ttf",
        },
        {
            "regular_name": "DejaVu",
            "bold_name":    "DejaVu-Bold",
            "mono_name":    "DejaVuMono",
            "regular_path": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "bold_path":    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "mono_path":    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        },
        {
            "regular_name": "LiberationSans",
            "bold_name":    "LiberationSans-Bold",
            "mono_name":    "LiberationMono",
            "regular_path": "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "bold_path":    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "mono_path":    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        },
    ]
    for item in candidates:
        r, b, m = Path(item["regular_path"]), Path(item["bold_path"]), Path(item["mono_path"])
        if r.exists() and b.exists() and m.exists():
            pdfmetrics.registerFont(TTFont(item["regular_name"], str(r)))
            pdfmetrics.registerFont(TTFont(item["bold_name"],    str(b)))
            pdfmetrics.registerFont(TTFont(item["mono_name"],    str(m)))
            return item["regular_name"], item["bold_name"], item["mono_name"]

    print("⚠️ Không tìm thấy font Unicode — dùng Helvetica/Courier fallback")
    return "Helvetica", "Helvetica-Bold", "Courier"


# ── Path helpers ─────────────────────────────────────────────────────────────

def normalize_image_path(raw: str) -> str:
    if not raw:
        return ""
    raw = raw.strip().strip("`").strip('"\'').replace("\\", "/").lstrip("./")
    if re.match(r"^[A-Za-z]:/", raw):
        p = Path(raw)
        return f"highlighted/{p.name}" if p.parent.name.lower() == "highlighted" else p.name
    if "highlighted/" in raw:
        return f"highlighted/{raw.split('highlighted/')[-1]}"
    if raw.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return f"highlighted/{raw}"
    return raw


def resolve_image_file(md_img_path: str, output_dir: Path) -> Path:
    md_img_path = md_img_path.replace("\\", "/").strip()
    if re.match(r"^[A-Za-z]:/", md_img_path):
        return Path(md_img_path)
    return output_dir / md_img_path


# ── Parse helpers ────────────────────────────────────────────────────────────

def extract_image_path(text: str) -> str | None:
    patterns = [
        r"(?:Khung\s*hình\s*gốc|Hình\s*ảnh\s*minh\s*họa|Screenshot|Image|Ảnh)\s*\*{0,2}\s*:\s*\*{0,2}\s*`?([^`\n\r]+?\.(?:png|jpg|jpeg|webp))`?",
        r"`([^`\n\r]+?\.(?:png|jpg|jpeg|webp))`",
        r"([A-Za-z]:[\\/][^\n\r]+?\.(?:png|jpg|jpeg|webp))",
        r"((?:\.\/)?(?:output\/)?highlighted\/[^\s`\n\r]+?\.(?:png|jpg|jpeg|webp))",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return normalize_image_path(m.group(1))
    return None


def extract_pixel(text: str) -> str | None:
    patterns = [
        r"<pixel>\s*\[(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]\s*</pixel>",
        r"Vị\s*trí\s*tương\s*tác\s*\*{0,2}\s*:\s*\*{0,2}\s*`?\[?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]?`?",
        r"pixel\s*\*{0,2}\s*:\s*\*{0,2}\s*`?\[?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]?`?",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return f"[{m.group(1)}, {m.group(2)}, {m.group(3)}, {m.group(4)}]"
    return None


def split_steps(ai_text: str) -> list[tuple[str, str]]:
    pattern = re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*((?:Bước|Step)\s*\d+\s*[:.\-–]\s*.+?)(?:\*\*)?\s*$"
    )
    matches = list(pattern.finditer(ai_text))
    steps   = []
    for idx, m in enumerate(matches):
        title   = m.group(1).replace("**", "").strip()
        start   = m.end()
        end     = matches[idx + 1].start() if idx + 1 < len(matches) else len(ai_text)
        steps.append((title, ai_text[start:end].strip()))
    return steps


def clean_meta_lines(text: str) -> str:
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.search(r"Khung\s*hình\s*gốc|Hình\s*ảnh\s*minh\s*họa|Screenshot|Image|Ảnh", s, re.IGNORECASE):
            continue
        if re.search(r"Vị\s*trí\s*tương\s*tác|<pixel>|pixel\s*:", s, re.IGNORECASE):
            continue
        if re.fullmatch(r"-{3,}", s):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def md_inline_to_reportlab(text: str, mono_font: str = "Courier") -> str:
    text = text.strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", rf"<font name='{mono_font}'>\1</font>", text)
    text = re.sub(r"^((?:Mô\s*tả|Kết\s*quả)\s*:)", r"<b>\1</b>", text, flags=re.IGNORECASE)

    result, i = [], 0
    while i < len(text):
        tag = re.match(r"</?(?:b|font)[^>]*>", text[i:])
        if tag:
            result.append(tag.group(0))
            i += len(tag.group(0))
            continue
        ch = text[i]
        if   ch == "&": result.append("&amp;")
        elif ch == "<": result.append("&lt;")
        elif ch == ">": result.append("&gt;")
        elif ord(ch) > 127: result.append(f"&#{ord(ch)};")
        else: result.append(ch)
        i += 1
    return "".join(result)


# ── Image helper ─────────────────────────────────────────────────────────────

def add_scaled_image(story: list, image_path: Path, max_width: float, max_height: float):
    reader     = ImageReader(str(image_path))
    iw, ih     = reader.getSize()
    ratio      = min(max_width / iw, max_height / ih)
    story.append(Image(str(image_path), width=iw * ratio, height=ih * ratio))
    story.append(Spacer(1, 15))


# ── Public API ───────────────────────────────────────────────────────────────

def build_md(
    ai_output: str | None = None,
    output_md: Path | None = None,
) -> Path:
    text = (ai_output or AI_OUTPUT).strip()
    if not text:
        raise ValueError("ai_output rỗng")

    out = output_md or (_OUTPUT_DIR / "HUONG_DAN_SU_DUNG_FINAL.md")
    out.parent.mkdir(parents=True, exist_ok=True)

    img_base = out.parent
    steps    = split_steps(text)
    if not steps:
        raise ValueError("Không tìm thấy bước nào")

    md = "# HƯỚNG DẪN SỬ DỤNG\n\n"
    for title, content in steps:
        img_path = extract_image_path(content)
        pixel    = extract_pixel(content)
        clean    = clean_meta_lines(content)

        md += f"### {title}\n\n"
        if clean:
            md += f"{clean}\n\n"
        if img_path:
            md += "* **Hình ảnh minh họa:**\n"
            md += f"![{title}]({img_path})\n\n"
            if not resolve_image_file(img_path, img_base).exists():
                print(f"⚠️ Không tìm thấy ảnh: {img_path}")
        if pixel:
            md += f"> Vị trí tương tác: `{pixel}`\n\n"
        md += "---\n\n"

    out.write_text(md, encoding="utf-8")
    print(f"✅ Đã lưu Markdown: {out}")
    return out


def build_pdf_from_md(
    md_file: Path,
    pdf_file: Path | None = None,
) -> Path:
    print("⏳ Đang compile PDF...")

    regular_font, bold_font, mono_font = register_vietnamese_font()

    out = pdf_file or md_file.with_suffix(".pdf")
    img_base = md_file.parent

    doc = SimpleDocTemplate(
        str(out), pagesize=A4,
        rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40,
    )
    page_width, page_height = A4
    usable_w = page_width  - doc.leftMargin - doc.rightMargin
    usable_h = page_height - doc.topMargin  - doc.bottomMargin

    styles = getSampleStyleSheet()

    h1_style = ParagraphStyle("DocTitle",    parent=styles["Heading1"], fontName=bold_font,    fontSize=18, leading=24, alignment=1, textColor=colors.HexColor("#1a5276"), spaceAfter=18)
    title_style = ParagraphStyle("StepTitle", parent=styles["Heading2"], fontName=bold_font,   fontSize=14, leading=18, textColor=colors.HexColor("#1a5276"), spaceAfter=10)
    body_style  = ParagraphStyle("StepBody",  parent=styles["Normal"],  fontName=regular_font, fontSize=11, leading=16, textColor=colors.HexColor("#333333"), spaceAfter=8)
    note_style  = ParagraphStyle("Note",      parent=styles["Normal"],  fontName=regular_font, fontSize=9,  leading=13, textColor=colors.HexColor("#777777"), leftIndent=12, spaceAfter=8)

    story = []

    for line in md_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue

        if line.startswith("# "):
            story.append(Paragraph(md_inline_to_reportlab(line[2:].strip(), mono_font), h1_style))
        elif line.startswith("###"):
            story.append(Paragraph(md_inline_to_reportlab(line.lstrip("#").strip(), mono_font), title_style))
            story.append(Spacer(1, 5))
        elif line.startswith("![") and "](" in line:
            m = re.search(r"\((.+?)\)", line)
            if m:
                img_path = resolve_image_file(normalize_image_path(m.group(1)), img_base)
                if img_path.exists():
                    add_scaled_image(story, img_path, usable_w, usable_h * 0.42)
                else:
                    print(f"⚠️ Không tìm thấy ảnh: {img_path}")
        elif line == "---":
            story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#dddddd"), spaceBefore=15, spaceAfter=15))
        elif line.startswith(">"):
            story.append(Paragraph(md_inline_to_reportlab(line.lstrip(">").strip(), mono_font), note_style))
        elif "Hình ảnh minh họa" in line:
            pass  # bỏ qua label, ảnh đã render bên dưới
        else:
            story.append(Paragraph(md_inline_to_reportlab(line, mono_font), body_style))
            story.append(Spacer(1, 4))

    doc.build(story)
    print(f"🎉 Đã xuất PDF: {out}")
    return out


# ── Standalone ───────────────────────────────────────────────────────────────

def main():
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    md  = build_md()
    build_pdf_from_md(md)


if __name__ == "__main__":
    main()