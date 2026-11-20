"""Supabase JWT verification.

The browser signs in with Supabase Auth and sends the session's access token
as ``Authorization: Bearer <jwt>``. We verify it server-side:

* Newer Supabase projects sign with asymmetric keys (ES256/RS256) published at
  ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json`` — verified with that JWKS.
* Legacy projects sign with HS256 — verified with ``SUPABASE_JWT_SECRET``.

Audience must be ``authenticated`` and the token must not be expired. The
role and company are then read from ``public.profiles`` (never from the
token's metadata, which a user could influence), and the account must be
active. Employees must also be linked to an active ``employees`` row.
"""
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

from accounts.models import Company, Profile
from employees.models import Employee

log = logging.getLogger("absenninn.auth")


@dataclass
class AppUser:
    profile: Profile
    company: Company
    employee: Optional[Employee]

    is_authenticated = True
    is_anonymous = False

    @property
    def pk(self):
        return self.profile.id

    id = pk

    @property
    def role(self):
        return self.profile.role

    @property
    def is_owner(self):
        return self.profile.role == "owner"

    @property
    def is_employee(self):
        return self.profile.role == "employee"

    @property
    def company_id(self):
        return self.profile.company_id

    @property
    def employee_id(self):
        return self.employee.id if self.employee else None

    @property
    def full_name(self):
        return self.profile.full_name

    def __str__(self):
        return f"{self.profile.email} ({self.profile.role})"


@lru_cache(maxsize=1)
def _jwks_client():
    if not settings.SUPABASE_URL:
        raise exceptions.AuthenticationFailed("SUPABASE_URL belum dikonfigurasi di server")
    return jwt.PyJWKClient(f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def decode_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise exceptions.AuthenticationFailed("Token tidak valid")
    alg = header.get("alg")
    opts = {"require": ["exp", "sub"]}
    try:
        if alg == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise exceptions.AuthenticationFailed("SUPABASE_JWT_SECRET belum dikonfigurasi di server")
            return jwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"],
                              audience=settings.SUPABASE_JWT_AUDIENCE, options=opts, leeway=30)
        if alg in ("ES256", "RS256", "EdDSA"):
            key = _jwks_client().get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=[alg], audience=settings.SUPABASE_JWT_AUDIENCE, options=opts, leeway=30)
    except jwt.ExpiredSignatureError:
        raise exceptions.AuthenticationFailed("Sesi berakhir, silakan login kembali")
    except jwt.PyJWKClientError as e:
        log.warning("JWKS error: %s", e)
        raise exceptions.AuthenticationFailed("Token tidak dapat diverifikasi")
    except jwt.PyJWTError:
        raise exceptions.AuthenticationFailed("Token tidak valid")
    raise exceptions.AuthenticationFailed("Algoritma token tidak didukung")


def load_user(sub: str) -> AppUser:
    try:
        profile = Profile.objects.select_related("company").get(id=sub)
    except (Profile.DoesNotExist, ValueError):
        raise exceptions.PermissionDenied("Akun belum terhubung ke perusahaan")
    if not profile.is_active:
        raise exceptions.PermissionDenied("Akun ini telah dinonaktifkan. Hubungi owner.")
    employee = None
    if profile.role == "employee":
        employee = Employee.objects.filter(profile_id=profile.id).first()
        if not employee or employee.employment_status != "active":
            raise exceptions.PermissionDenied("Akun karyawan ini nonaktif atau belum terhubung. Hubungi owner.")
    return AppUser(profile=profile, company=profile.company, employee=employee)


class SupabaseJWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            raise exceptions.AuthenticationFailed("Header Authorization tidak valid")
        claims = decode_token(parts[1])
        if claims.get("role") not in (None, "authenticated"):
            raise exceptions.AuthenticationFailed("Token bukan milik pengguna aplikasi")
        return load_user(claims["sub"]), claims

    def authenticate_header(self, request):
        return self.keyword
