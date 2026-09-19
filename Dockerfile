# ── Stage: runtime ────────────────────────────────────────────────────────────
FROM python:3.12-slim

# Utilizator fără privilegii: containerul nu rulează ca root
RUN useradd --create-home --uid 10001 app

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
# (avoids a 500 MB download on first container start). Rulat ca utilizatorul
# `app`, ca modelele să ajungă în ~/.EasyOCR-ul lui.
USER app
RUN python -c "import easyocr; easyocr.Reader(['ro', 'en'], gpu=False, verbose=False)"

COPY --chown=app:app . .

RUN mkdir -p uploads

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8080'))"

# Gunicorn (nu serverul de dezvoltare Flask). Un singur worker: modelele EasyOCR sunt grele.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 300 app:app"]
