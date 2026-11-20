"""Uniform error envelope understood by frontend/js/api.js:
    {"detail": "<pesan>", "code": "<KODE>", "<field>": "<pesan field>", ...}
Field errors sit at the top level because UI.showErrors(form, e.details)
maps keys straight onto form fields.
"""
import logging

from django.http import Http404
from rest_framework import exceptions as drf
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

log = logging.getLogger("absenninn")


class ApiError(Exception):
    def __init__(self, message, code="ERROR", status=400, errors=None, extra=None):
        super().__init__(message)
        self.message, self.code, self.status = message, code, status
        self.errors = errors or {}
        self.extra = extra or {}


def validation(errors, message="Periksa kembali data yang diisi"):
    """Raise a 422 VALIDATION error if ``errors`` is non-empty."""
    if errors:
        raise ApiError(message, "VALIDATION", 422, errors)


def not_found(message="Data tidak ditemukan"):
    return ApiError(message, "NOT_FOUND", 404)


def forbidden(message="Akses ditolak"):
    return ApiError(message, "FORBIDDEN", 403)


def get_or_404(qs, message="Data tidak ditemukan", **lookup):
    """qs.get(**lookup) that turns missing rows *and* malformed ids into 404."""
    from django.core.exceptions import ValidationError
    try:
        return qs.get(**lookup)
    except (qs.model.DoesNotExist, ValueError, ValidationError):
        raise not_found(message)


def handler(exc, context):
    if isinstance(exc, ApiError):
        body = {"detail": exc.message, "code": exc.code, **exc.errors, **exc.extra}
        return Response(body, status=exc.status)
    if isinstance(exc, Http404):
        return Response({"detail": "Data tidak ditemukan", "code": "NOT_FOUND"}, status=404)
    if isinstance(exc, drf.NotAuthenticated):
        return Response({"detail": "Silakan login terlebih dahulu", "code": "UNAUTHORIZED"}, status=401)
    if isinstance(exc, drf.AuthenticationFailed):
        return Response({"detail": str(exc.detail), "code": "UNAUTHORIZED"}, status=401)
    if isinstance(exc, drf.PermissionDenied):
        return Response({"detail": str(exc.detail), "code": "FORBIDDEN"}, status=403)
    if isinstance(exc, drf.Throttled):
        return Response({"detail": "Terlalu banyak permintaan. Coba lagi sebentar.", "code": "RATE_LIMITED"}, status=429)
    if isinstance(exc, drf.ParseError):
        return Response({"detail": "Format data tidak valid", "code": "BAD_REQUEST"}, status=400)
    if isinstance(exc, drf.MethodNotAllowed):
        return Response({"detail": "Metode tidak diizinkan", "code": "METHOD_NOT_ALLOWED"}, status=405)
    resp = drf_handler(exc, context)
    if resp is not None:
        return resp
    log.exception("Unhandled API error", exc_info=exc)
    return Response({"detail": "Terjadi kesalahan pada server", "code": "SERVER_ERROR"}, status=500)
