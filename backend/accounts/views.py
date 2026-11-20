from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsOwner
from employees.services import employee_out

from .models import AuditLog
from .services import company_out, settings_for, update_settings


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        with connection.cursor() as c:
            c.execute("select 1")
        return Response({"status": "ok"})


class MeView(APIView):
    def get(self, request):
        u = request.user
        p = u.profile
        return Response({"id": p.id, "company_id": p.company_id, "role": p.role, "full_name": p.full_name, "email": p.email,
                         "avatar_color": p.avatar_color, "is_active": p.is_active, "employee_id": u.employee_id,
                         "company": company_out(u.company), "employee": employee_out(u.employee) if u.employee else None})


class SettingsView(APIView):
    def get(self, request):
        return Response(settings_for(request.user))


class SettingsSectionView(APIView):
    permission_classes = [IsOwner]

    def put(self, request, section):
        return Response(update_settings(request.user, section, request.data))


class AuditLogView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        try:
            limit = max(1, min(200, int(request.query_params.get("limit") or 20)))
        except ValueError:
            limit = 20
        rows = AuditLog.objects.filter(company_id=request.user.company_id).order_by("-created_at")[:limit]
        return Response([{"id": a.id, "company_id": a.company_id, "actor_id": a.actor_id, "actor_name": a.actor_name, "action": a.action,
                          "entity": a.entity, "entity_id": a.entity_id, "summary": a.summary, "extra": a.details, "created_at": a.created_at}
                         for a in rows])
