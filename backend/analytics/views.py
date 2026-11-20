from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import get_or_404
from core.permissions import IsOwner
from employees.models import Employee

from . import services as svc


class PerformanceView(APIView):
    """GET /api/analytics/performance/?range=this_month|last_month|last_90[&employee_id=…]"""
    permission_classes = [IsOwner]

    def get(self, request):
        emp = request.query_params.get("employee_id")
        if emp:
            get_or_404(Employee.objects.filter(company_id=request.user.company_id), "Karyawan tidak ditemukan", id=emp)
        return Response(svc.performance(request.user, request.query_params.get("range") or "this_month", emp))
