# Build from the repository root:  docker build -f backend/Dockerfile -t ihatefile-api .
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    IHATEFILE_TMP_ROOT=/tmp/ihatefile

# Conversion engines. LibreOffice is large (~600 MB installed); drop the libreoffice-* lines
# (the tool then reports itself unavailable) if your host cannot afford it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg pandoc tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/asgi.py .
COPY shared/registry.json ./shared/registry.json

USER app
EXPOSE 8000
# $PORT is honoured by hosts such as Render/Railway; defaults to 8000.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/api/v1/health' % os.environ.get('PORT','8000'), timeout=4)"
CMD ["sh", "-c", "exec uvicorn asgi:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]
