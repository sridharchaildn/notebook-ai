FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8790

WORKDIR /app

COPY services/cloud-api /app/services/cloud-api
COPY VERSION /app/VERSION

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e /app/services/cloud-api

EXPOSE 8790

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8790"]
