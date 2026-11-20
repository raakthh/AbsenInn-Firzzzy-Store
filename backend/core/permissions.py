from rest_framework.permissions import BasePermission


class IsActiveMember(BasePermission):
    """Any signed-in, active member of a company (owner or employee).
    Activity checks happen in authentication (core.auth.load_user)."""
    message = "Silakan login terlebih dahulu"

    def has_permission(self, request, view):
        return bool(request.user and getattr(request.user, "is_authenticated", False))


class IsOwner(IsActiveMember):
    message = "Akses ditolak: khusus Owner"

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_owner


class IsEmployee(IsActiveMember):
    message = "Akses ditolak: khusus Employee"

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_employee
