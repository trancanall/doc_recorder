import re
from pathlib import Path

# --- CẤU HÌNH ---
BASE_DIR = Path(r"D:\manual-doc-recorder")
OUTPUT_DIR = BASE_DIR / "output"
HIGHLIGHT_DIR = OUTPUT_DIR / "highlighted"
OUTPUT_MD = OUTPUT_DIR / "HUONG_DAN_SU_DUNG_FINAL.md"

AI_OUTPUT = """
**Bước 1: Nhập địa chỉ Email**

* **Mô tả:** Nhấp vào ô nhập liệu **Email** và điền địa chỉ email đăng nhập của bạn. Ví dụ: `admin@gmail.com`.
* **Khung hình gốc:** `highlighted/step_002_highlight.png`
* **Vị trí tương tác:** <pixel>[450, 249, 816, 291]</pixel>

---

**Bước 2: Nhập Mật khẩu**

* **Mô tả:** Nhấp vào ô nhập liệu **Mật khẩu** và điền mật khẩu đăng nhập của bạn. Ví dụ: `123456@Aa`.
* **Khung hình gốc:** `highlighted/step_006_highlight.png`
* **Vị trí tương tác:** <pixel>[450, 309, 774, 351]</pixel>

---

**Bước 3: Nhấn nút Đăng Nhập**

* **Mô tả:** Sau khi đã điền đầy đủ email và mật khẩu, nhấp vào nút **Đăng Nhập** để xác nhận và gửi thông tin đăng nhập. Hệ thống sẽ xác thực và chuyển hướng bạn vào trang chủ nếu thông tin chính xác.
* **Khung hình gốc:** `highlighted/step_007_highlight.png`
* **Vị trí tương tác:** <pixel>[450, 396, 816, 430]</pixel>
"""


def normalize_image_path(raw_path: str) -> str:
    """
    Nhận nhiều kiểu path:
    - highlighted/step.png
    - ./highlighted/step.png
    - output/highlighted/step.png
    - D:\\manual-doc-recorder\\output\\highlighted\\step.png

    Trả về path tương đối để file MD nằm trong thư mục output đọc được:
    - highlighted/step.png
    """

    if not raw_path:
        return ""

    raw_path = raw_path.strip()
    raw_path = raw_path.strip("`")
    raw_path = raw_path.strip('"').strip("'")
    raw_path = raw_path.replace("\\", "/")

    # Nếu AI trả path tuyệt đối Windows
    # Ví dụ: D:/manual-doc-recorder/output/highlighted/step.png
    if re.match(r"^[A-Za-z]:/", raw_path):
        p = Path(raw_path)
        return p.name if p.parent.name != "highlighted" else f"highlighted/{p.name}"

    # Nếu AI trả ./highlighted/step.png
    raw_path = raw_path.lstrip("./")

    # Nếu AI trả output/highlighted/step.png
    if "highlighted/" in raw_path:
        filename = raw_path.split("highlighted/")[-1]
        return f"highlighted/{filename}"

    # Nếu AI chỉ trả step_001.png
    if raw_path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return f"highlighted/{raw_path}"

    return raw_path


def extract_image_path(text: str) -> str | None:
    """
    Bắt nhiều kiểu dòng ảnh:
    * **Khung hình gốc:** `highlighted/step.png`
    - Khung hình gốc: highlighted/step.png
    **Hình ảnh:** `...`
    Screenshot: ...
    image: ...
    """

    patterns = [
        r"(?:Khung\s*hình\s*gốc|Hình\s*ảnh\s*minh\s*họa|Screenshot|Image|Ảnh)\s*\*{0,2}\s*:\s*\*{0,2}\s*`?([^`\n\r]+?\.(?:png|jpg|jpeg|webp))`?",
        r"`([^`\n\r]+?\.(?:png|jpg|jpeg|webp))`",
        r"([A-Za-z]:[\\/][^\n\r]+?\.(?:png|jpg|jpeg|webp))",
        r"((?:\.\/)?(?:output\/)?highlighted\/[^\s`\n\r]+?\.(?:png|jpg|jpeg|webp))",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return normalize_image_path(match.group(1))

    return None


def extract_pixel(text: str) -> str | None:
    """
    Bắt các kiểu:
    <pixel>[450, 249, 816, 291]</pixel>
    [450,249,816,291]
    pixel: 450, 249, 816, 291
    """

    patterns = [
        r"<pixel>\s*\[(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]\s*</pixel>",
        r"Vị\s*trí\s*tương\s*tác\s*\*{0,2}\s*:\s*\*{0,2}\s*`?\[?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]?`?",
        r"pixel\s*\*{0,2}\s*:\s*\*{0,2}\s*`?\[?(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]?`?",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return f"[{match.group(1)}, {match.group(2)}, {match.group(3)}, {match.group(4)}]"

    return None


def clean_meta_lines(text: str) -> str:
    """
    Xóa các dòng kỹ thuật: Khung hình gốc, Vị trí tương tác, pixel.
    """

    lines = []

    for line in text.splitlines():
        stripped = line.strip()

        if not stripped:
            continue

        if re.search(r"Khung\s*hình\s*gốc|Hình\s*ảnh\s*minh\s*họa|Screenshot|Image|Ảnh", stripped, re.IGNORECASE):
            continue

        if re.search(r"Vị\s*trí\s*tương\s*tác|<pixel>|pixel\s*:", stripped, re.IGNORECASE):
            continue

        # Bỏ dòng phân cách cũ, lát nữa mình tự thêm ---
        if re.fullmatch(r"-{3,}", stripped):
            continue

        lines.append(line.rstrip())

    return "\n".join(lines).strip()


def split_steps(ai_text: str):
    """
    Tách step mềm hơn.
    Bắt được:
    **Bước 1: abc**
    ### Bước 1: abc
    Bước 1 - abc
    Step 1: abc
    """

    pattern = re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*((?:Bước|Step)\s*\d+\s*[:.\-–]\s*.+?)(?:\*\*)?\s*$"
    )

    matches = list(pattern.finditer(ai_text))
    steps = []

    if not matches:
        return steps

    for idx, match in enumerate(matches):
        title = match.group(1).strip()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(ai_text)

        content = ai_text[start:end].strip()
        steps.append((title, content))

    return steps


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    steps = split_steps(AI_OUTPUT)

    if not steps:
        raise ValueError("Không tìm thấy bước nào trong AI_OUTPUT. Kiểm tra lại format tiêu đề Bước/Step.")

    final_markdown = "# HƯỚNG DẪN SỬ DỤNG\n\n"

    for title, content in steps:
        clean_title = title.replace("**", "").strip()

        img_path = extract_image_path(content)
        pixel = extract_pixel(content)
        clean_content = clean_meta_lines(content)

        final_markdown += f"### {clean_title}\n\n"

        if clean_content:
            final_markdown += f"{clean_content}\n\n"

        if img_path:
            # Kiểm tra file có thật không để báo warning
            image_file = OUTPUT_DIR / img_path.replace("/", "\\")

            final_markdown += "* **Hình ảnh minh họa:**\n"
            final_markdown += f"![{clean_title}]({img_path})\n\n"

            if not image_file.exists():
                print(f"⚠️ Không tìm thấy ảnh: {image_file}")

        if pixel:
            # Nếu không muốn hiện pixel trong MD thì xóa 2 dòng này
            final_markdown += f"> Vị trí tương tác: `{pixel}`\n\n"

        final_markdown += "---\n\n"

    OUTPUT_MD.write_text(final_markdown, encoding="utf-8")

    print(f"✅ Đã xuất file Markdown: {OUTPUT_MD}")


if __name__ == "__main__":
    main()