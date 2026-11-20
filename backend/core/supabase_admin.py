"""Server-only calls to the Supabase Auth admin API (service-role key).
Used when the owner adds an employee with "Buat akun login": the employee
receives an e-mail invitation and sets their own password — the owner never
sees or chooses it."""
import logging

import requests
from django.conf import settings

from core.exceptions import ApiError

log = logging.getLogger("absenninn.supabase")


def _headers():
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise ApiError("Pembuatan akun membutuhkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di server", "AUTH_ADMIN_NOT_CONFIGURED", 500)
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}


def find_user_id(email):
    """Look up an existing auth user by e-mail (paged admin listing)."""
    h = _headers()
    for page in range(1, 20):
        r = requests.get(f"{settings.SUPABASE_URL}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=h, timeout=15)
        if r.status_code >= 300:
            return None
        users = r.json().get("users", [])
        for u in users:
            if (u.get("email") or "").lower() == email.lower():
                return u["id"]
        if len(users) < 200:
            return None
    return None


def invite_user(email, full_name):
    """Create the Supabase Auth user via invitation e-mail. Returns the user id."""
    h = _headers()
    try:
        r = requests.post(f"{settings.SUPABASE_URL}/auth/v1/invite", headers=h, timeout=20,
                          json={"email": email, "data": {"full_name": full_name}},
                          params={"redirect_to": f"{settings.FRONTEND_URL}/reset-password.html"})
    except requests.RequestException as e:
        log.warning("invite failed: %s", e)
        raise ApiError("Tidak dapat menghubungi Supabase Auth untuk membuat akun", "AUTH_ADMIN_UNAVAILABLE", 502)
    if r.status_code < 300:
        return r.json()["id"]
    if r.status_code == 422 or "already" in r.text.lower():
        uid = find_user_id(email)
        if uid:
            return uid
    log.warning("invite %s → %s %s", email, r.status_code, r.text[:200])
    raise ApiError("Gagal membuat akun login di Supabase Auth", "AUTH_ADMIN_ERROR", 502)
