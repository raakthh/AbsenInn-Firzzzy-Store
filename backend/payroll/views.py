import re

from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsEmployee, IsOwner

from . import services as svc
from .models import Payslip
from .pdf import render_payslip


class PeriodListView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        return Response(svc.periods(request.user))


class GenerateView(APIView):
    permission_classes = [IsOwner]

    def post(self, request):
        return Response(svc.generate(request.user, request.data.get("period_key")))


class PeriodDetailView(APIView):
    permission_classes = [IsOwner]

    def get(self, request, pk):
        return Response(svc.get_period(request.user, pk))


class RecalculateView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.recalculate(request.user, pk))


class TransitionView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk, action):
        return Response(svc.transition(request.user, pk, action, request.data))


class ConfirmPaymentView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.confirm_payment(request.user, pk, request.data))


class ItemView(APIView):
    def get(self, request, pk):
        return Response(svc.get_item(request.user, pk))

    def patch(self, request, pk):
        if not request.user.is_owner:
            return Response({"detail": "Akses ditolak: khusus Owner", "code": "FORBIDDEN"}, status=403)
        return Response(svc.update_item(request.user, pk, request.data))


class ItemPdfView(APIView):
    """Payslip PDF. Employees: own slip, only once the period is approved."""
    def get(self, request, pk):
        item = svc.get_item(request.user, pk)
        label = svc.month_label(item["period"]["period_key"])
        pdf = render_payslip(item, request.user.company, label)
        Payslip.objects.update_or_create(payroll_item_id=item["id"], defaults={"company_id": item["company_id"], "employee_id": item["employee_id"]})
        name = re.sub(r"[^A-Za-z0-9_-]+", "-", f"slip-gaji-{item['period']['period_key']}-{item['employee']['full_name']}").strip("-")
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{name}.pdf"'
        resp["Cache-Control"] = "private, no-store"
        return resp


class AdjustmentListView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.add_adjustment(request.user, pk, request.data), status=201)


class AdjustmentDetailView(APIView):
    permission_classes = [IsOwner]

    def delete(self, request, pk, adj):
        return Response(svc.remove_adjustment(request.user, pk, adj))


class SalaryConfigListView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        return Response(svc.salary_configs(request.user))


class SalaryConfigDetailView(APIView):
    permission_classes = [IsOwner]

    def put(self, request, emp_id):
        return Response(svc.update_salary_config(request.user, emp_id, request.data))


class MyPayslipsView(APIView):
    permission_classes = [IsEmployee]

    def get(self, request):
        return Response(svc.my_payslips(request.user))


class EmployeeItemsView(APIView):
    permission_classes = [IsOwner]

    def get(self, request, emp_id):
        return Response(svc.employee_items(request.user, emp_id))


