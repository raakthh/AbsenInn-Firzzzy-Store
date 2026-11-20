# AbsenInn — one container: Django REST API (/api) + static frontend (/) via WhiteNoise.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    DJANGO_DEBUG=False SERVE_FRONTEND=True PORT=8000

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY frontend frontend
COPY database database
COPY tools/supabase_shim.sql tools/supabase_shim.sql

RUN useradd --create-home app && chown -R app /app
USER app
WORKDIR /app/backend
EXPOSE 8000
# FRONTEND_MODE=production → config.js switched to production inside the container (the repo stays demo).
CMD python manage.py write_frontend_config && gunicorn config.wsgi --bind 0.0.0.0:${PORT} --workers ${WEB_CONCURRENCY:-2} --timeout 60 --access-logfile -
