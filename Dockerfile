# ── Stage: runtime ────────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# System libs needed by PyMuPDF, Pillow, EasyOCR
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only PyTorch first (saves ~2 GB vs the default CUDA build)
RUN pip install --no-cache-dir \
        torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu

# All other dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download EasyOCR models so they're baked into the image
# (avoids a 500 MB download on first container start)
RUN python -c "import easyocr; easyocr.Reader(['ro', 'en'], gpu=False, verbose=False)"

COPY . .

RUN mkdir -p uploads

EXPOSE 5000

# Gunicorn for production; falls back to Flask dev server if not installed
CMD ["python", "app.py"]
