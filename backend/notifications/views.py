from django.db import transaction
from rest_framework.response import Response
from rest_framework.views import APIView

from core.context import now
from core.events import audit, notify
from core.exceptions import get_or_404, validation
from core.permissions import IsOwner
from employees.models import Employee

from .models import Announcement, Notification


def notification_out(n):
    return {"id": n.id, "company_id": n.company_id, "recipient_id": n.recipient_id, "type": n.type, "title": n.title,
            "message": n.message, "link": n.link, "read": n.read_at is not None, "read_at": n.read_at, "created_at": n.created_at}


def announcement_out(a):
    return {"id": a.id, "company_id": a.company_id, "title": a.title, "body": a.body, "pinned": a.pinned,
            "created_at": a.created_at, "created_by": a.created_by_id}


class NotificationListView(APIView):
    def get(self, request):
        qs = Notification.objects.filter(recipient_id=request.user.profile.id).order_by("-created_at")
        try:
            limit = max(1, min(500, int(request.query_params.get("limit") or 100)))
        except ValueError:
            limit = 100
        return Response([notification_out(n) for n in qs[:limit]])


class NotificationReadView(APIView):
    def post(self, request, pk):
        n = get_or_404(Notification.objects.filter(recipient_id=request.user.profile.id), "Notifikasi tidak ditemukan", id=pk)
        if n.read_at is None:
            n.read_at = now()
            n.save(update_fields=["read_at"])
        return Response(notification_out(n))


class NotificationReadAllView(APIView):
    def post(self, request):
        Notification.objects.filter(recipient_id=request.user.profile.id, read_at__isnull=True).update(read_at=now())
        return Response(True)


class UnreadCountView(APIView):
    """Cheap endpoint for badge polling."""
    def get(self, request):
        return Response({"unread": Notification.objects.filter(recipient_id=request.user.profile.id, read_at__isnull=True).count()})


class AnnouncementListView(APIView):
    def get(self, request):
        qs = Announcement.objects.filter(company_id=request.user.company_id).order_by("-pinned", "-created_at")
        return Response([announcement_out(a) for a in qs])

    @transaction.atomic
    def post(self, request):
        if not request.user.is_owner:
            return Response({"detail": "Akses ditolak: khusus Owner", "code": "FORBIDDEN"}, status=403)
        d, errors = request.data, {}
        title, body = (d.get("title") or "").strip(), (d.get("body") or "").strip()
        if len(title) < 3:
            errors["title"] = "Judul minimal 3 karakter"
        if len(body) < 10:
            errors["body"] = "Isi minimal 10 karakter"
        validation(errors, "Periksa pengumuman")
        u = request.user
        a = Announcement.objects.create(company_id=u.company_id, title=title, body=body,
                                        pinned=d.get("pinned") in (True, "true", "on", 1, "1"), created_by_id=u.profile.id)
        for e in Employee.objects.filter(company_id=u.company_id, employment_status="active", profile_id__isnull=False):
            notify(u.company_id, e.profile_id, "announcement", "Pengumuman baru", a.title, "employee/announcements.html")
        audit(u, "announcement.create", "announcement", a.id, f'Membuat pengumuman "{a.title}"')
        return Response(announcement_out(a), status=201)


class AnnouncementDetailView(APIView):
    permission_classes = [IsOwner]

    def delete(self, request, pk):
        a = get_or_404(Announcement.objects.filter(company_id=request.user.company_id), "Pengumuman tidak ditemukan", id=pk)
        a.delete()
        audit(request.user, "announcement.delete", "announcement", pk, f'Menghapus pengumuman "{a.title}"')
        return Response(True)


class CronRemindersView(APIView):
    """POST /api/cron/reminders/ with header ``X-Cron-Secret: <CRON_SECRET>``.
    For hosts without a cron runner (e.g. trigger from GitHub Actions or cron-job.org)."""
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        import hmac

        from django.conf import settings

        from . import reminders
        secret = getattr(settings, "CRON_SECRET", "")
        given = request.headers.get("X-Cron-Secret", "")
        if not secret or not hmac.compare_digest(secret, given):
            return Response({"detail": "Tidak diizinkan", "code": "FORBIDDEN"}, status=403)
        with transaction.atomic():
            return Response({"sent": reminders.run()})
