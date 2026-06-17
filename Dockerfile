# ── Base: Python 3.11 slim ──────────────────────────────────────────────────
FROM python:3.11-slim

# Cài Node.js 20 LTS (dùng nodesource)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    fonts-liberation \
    libglib2.0-0 \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Python deps ─────────────────────────────────────────────────────────────
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Node deps (sharp cho highlight) ─────────────────────────────────────────
COPY package*.json ./
RUN npm install --omit=dev

# ── Copy source ──────────────────────────────────────────────────────────────
COPY . .

# Tạo thư mục output mặc định (volume mount sẽ override khi chạy)
RUN mkdir -p /app/output/highlighted /app/output/screenshots

# ── Expose & start ──────────────────────────────────────────────────────────
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]