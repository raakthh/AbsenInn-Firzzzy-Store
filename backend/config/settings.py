"""AbsenInn — Django settings.

All secrets come from environment variables (see ../.env.example). A local
``.env`` file next to the project root (AbsenInn/.env) is loaded if present.
The business schema is owned by database/migrations/*.sql; every model here
uses ``managed = False`` so ``manage.py migrate`` never touches those tables.
"""
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
PROJECT_DIR = BASE_DIR.parent                              # AbsenInn/


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(PROJECT_DIR / ".env")


def env(key, default=None):
    return os.environ.get(key, default)


def env_bool(key, default=False):
    return str(env(key, str(default))).lower() in ("1", "true", "yes", "on")


def env_list(key, default=""):
    return [x.strip() for x in str(env(key, default)).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY") or ("dev-only-insecure-key" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY wajib diisi saat DJANGO_DEBUG=False")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.postgres",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "core",
    "accounts",
    "employees",
    "attendance",
    "leave_management",
    "task_management",
    "payroll",
    "analytics",
    "notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = []

DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/absen"),
        conn_max_age=int(env("DB_CONN_MAX_AGE", "60")),
        conn_health_checks=True,
    )
}
# Supabase transaction pooler (port 6543) does not support prepared statements / server-side cursors.
if env_bool("DB_USE_POOLER", False):
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
    DATABASES["default"].setdefault("OPTIONS", {})["prepare_threshold"] = None

LANGUAGE_CODE = "id"
TIME_ZONE = "Asia/Jakarta"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
# Serve ../frontend at "/" (one origin for UI + API → no CORS, camera/GPS work on localhost/HTTPS).
SERVE_FRONTEND = env_bool("SERVE_FRONTEND", True)
if SERVE_FRONTEND:
    WHITENOISE_ROOT = PROJECT_DIR / "frontend"
    WHITENOISE_INDEX_FILE = True
WHITENOISE_AUTOREFRESH = DEBUG
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------- REST framework ----------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["core.auth.SupabaseJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["core.permissions.IsActiveMember"],
    "DEFAULT_RENDERER_CLASSES": ["core.renderers.AppJSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "EXCEPTION_HANDLER": "core.exceptions.handler",
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": env("API_THROTTLE_USER", "600/min")},
}
# Base64 selfie (≈ 200–600 KB) + JSON envelope.
DATA_UPLOAD_MAX_MEMORY_SIZE = 8 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024

# ---------------- CORS ----------------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,http://127.0.0.1:5500,http://localhost:5500")
CORS_ALLOW_HEADERS = ["authorization", "content-type"]

# ---------------- Supabase ----------------
SUPABASE_URL = (env("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", "")           # legacy HS256 projects
SUPABASE_JWT_AUDIENCE = env("SUPABASE_JWT_AUDIENCE", "authenticated")
STORAGE_BACKEND = env("STORAGE_BACKEND", "supabase")            # supabase | local
LOCAL_STORAGE_DIR = Path(env("LOCAL_STORAGE_DIR", str(BASE_DIR / "local_storage")))
BUCKET_SELFIES = env("SUPABASE_STORAGE_BUCKET_SELFIES", "attendance-selfies")
BUCKET_ATTACHMENTS = env("SUPABASE_STORAGE_BUCKET_ATTACHMENTS", "leave-attachments")
BUCKET_COMPANY = env("SUPABASE_STORAGE_BUCKET_COMPANY", "company-assets")
SIGNED_URL_EXPIRES_SECONDS = int(env("SIGNED_URL_EXPIRES_SECONDS", "300"))
# Where invited employees land after accepting the e-mail invitation.
CRON_SECRET = env("CRON_SECRET", "")                          # protects POST /api/cron/reminders/
FRONTEND_URL = (env("FRONTEND_URL") or "http://localhost:8000").rstrip("/")

# ---------------- Security (production) ----------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
SECURE_REFERRER_POLICY = "same-origin"
# Deliberately silenced deploy checks:
#  W003 — no CSRF middleware: the API authenticates only via "Authorization: Bearer" (no cookies/sessions),
#         so cross-site requests cannot ride on ambient credentials.
#  W005/W021 — HSTS includeSubDomains/preload must not be forced on shared hosts (e.g. *.onrender.com);
#         enable via SECURE_HSTS_INCLUDE_SUBDOMAINS / SECURE_HSTS_PRELOAD on your own domain.
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
SILENCED_SYSTEM_CHECKS = ["security.W003"] + ([] if SECURE_HSTS_INCLUDE_SUBDOMAINS else ["security.W005"]) + ([] if SECURE_HSTS_PRELOAD else ["security.W021"])
X_FRAME_OPTIONS = "DENY"

TEST_RUNNER = "core.testing.SchemaTestRunner"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
