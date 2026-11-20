"""File storage for selfies, leave attachments and company assets.

* ``supabase`` (production): private Supabase Storage buckets, accessed with
  the service-role key **from the server only**. Reads go through short-lived
  signed URLs (SIGNED_URL_EXPIRES_SECONDS, default 5 minutes).
* ``local`` (development / tests): files under LOCAL_STORAGE_DIR; "signed URLs"
  are inline data: URLs so the browser can show them without a file server.

Paths follow the bucket policy convention ``<company_id>/<employee_id>/<file>``.
"""
import base64
import binascii
import logging
import mimetypes
import re
from pathlib import Path

import requests
from django.conf import settings

from core.exceptions import ApiError

log = logging.getLogger("absenninn.storage")

IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
ATTACHMENT_TYPES = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
MAX_SELFIE_BYTES = 2 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.S)


def sniff(data: bytes):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return None


def decode_data_url(value, allowed=IMAGE_TYPES, max_bytes=MAX_SELFIE_BYTES):
    """Validate a ``data:image/...;base64,...`` selfie. Content type is taken
    from the bytes themselves, not from the client's claim."""
    m = _DATA_URL.match(value or "") if isinstance(value, str) else None
    if not m:
        raise ApiError("Format selfie tidak valid", "VALIDATION", 422, {"selfie": "Format selfie tidak valid"})
    try:
        data = base64.b64decode(m.group("data"), validate=False)
    except (binascii.Error, ValueError):
        raise ApiError("Format selfie tidak valid", "VALIDATION", 422, {"selfie": "Format selfie tidak valid"})
    if len(data) > max_bytes:
        raise ApiError(f"Ukuran foto maksimal {max_bytes // (1024 * 1024)} MB", "VALIDATION", 422, {"selfie": "Ukuran foto terlalu besar"})
    mime = sniff(data)
    if mime not in allowed:
        raise ApiError("File harus berupa gambar JPG/PNG/WebP", "VALIDATION", 422, {"selfie": "Tipe file tidak didukung"})
    return data, mime


def check_upload(file, allowed=ATTACHMENT_TYPES, max_bytes=MAX_ATTACHMENT_BYTES, field="attachment"):
    if file.size > max_bytes:
        raise ApiError("Ukuran file maksimal 5 MB", "VALIDATION", 422, {field: "Ukuran file maksimal 5 MB"})
    data = file.read()
    mime = sniff(data)
    if mime not in allowed:
        raise ApiError("Lampiran harus PDF, JPG, atau PNG", "VALIDATION", 422, {field: "Lampiran harus PDF, JPG, atau PNG"})
    return data, mime


class StorageUnavailable(ApiError):
    def __init__(self, message="Upload foto gagal. Coba lagi."):
        super().__init__(message, "UPLOAD_FAILED", 502)


class SupabaseStorage:
    def __init__(self):
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            raise ApiError("Storage belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)", "STORAGE_NOT_CONFIGURED", 500)
        self.base = f"{settings.SUPABASE_URL}/storage/v1"
        self.headers = {"Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}", "apikey": settings.SUPABASE_SERVICE_ROLE_KEY}

    def upload(self, bucket, path, data, content_type):
        try:
            r = requests.post(f"{self.base}/object/{bucket}/{path}", data=data, timeout=20,
                              headers={**self.headers, "Content-Type": content_type, "x-upsert": "true", "Cache-Control": "private, max-age=0"})
        except requests.RequestException as e:
            log.warning("storage upload failed: %s", e)
            raise StorageUnavailable()
        if r.status_code >= 300:
            log.warning("storage upload %s → %s %s", path, r.status_code, r.text[:200])
            raise StorageUnavailable()
        return path

    def signed_url(self, bucket, path, expires=None):
        if not path:
            return None
        try:
            r = requests.post(f"{self.base}/object/sign/{bucket}/{path}", json={"expiresIn": expires or settings.SIGNED_URL_EXPIRES_SECONDS},
                              headers=self.headers, timeout=10)
            if r.status_code >= 300:
                log.warning("sign %s → %s", path, r.status_code)
                return None
            rel = r.json().get("signedURL") or r.json().get("signedUrl")
            return f"{self.base}{rel}" if rel and rel.startswith("/") else rel
        except (requests.RequestException, ValueError) as e:
            log.warning("sign failed: %s", e)
            return None

    def download(self, bucket, path):
        r = requests.get(f"{self.base}/object/{bucket}/{path}", headers=self.headers, timeout=20)
        return r.content if r.status_code < 300 else None

    def delete(self, bucket, path):
        try:
            requests.delete(f"{self.base}/object/{bucket}", json={"prefixes": [path]}, headers=self.headers, timeout=10)
        except requests.RequestException:
            pass


class LocalStorage:
    def __init__(self):
        self.root = Path(settings.LOCAL_STORAGE_DIR)

    def _p(self, bucket, path):
        p = (self.root / bucket / path).resolve()
        if self.root.resolve() not in p.parents:
            raise ApiError("Path tidak valid", "VALIDATION", 422)
        return p

    def upload(self, bucket, path, data, content_type):
        p = self._p(bucket, path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return path

    def signed_url(self, bucket, path, expires=None):
        if not path:
            return None
        p = self._p(bucket, path)
        if not p.exists():
            return None
        mime = sniff(p.read_bytes()[:16]) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"

    def download(self, bucket, path):
        p = self._p(bucket, path)
        return p.read_bytes() if p.exists() else None

    def delete(self, bucket, path):
        p = self._p(bucket, path)
        if p.exists():
            p.unlink()


def get_storage():
    return LocalStorage() if settings.STORAGE_BACKEND == "local" else SupabaseStorage()
