from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import forbidden
from core.permissions import IsOwner

from . import services as svc


class EmployeeListView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        return Response(svc.list_employees(request.user, request.query_params))

    def post(self, request):
        return Response(svc.create_employee(request.user, request.data), status=201)


class EmployeeDetailView(APIView):
    def get(self, request, pk):
        u = request.user
        if u.is_employee and str(u.employee_id) != str(pk):
            raise forbidden()
        e = svc.get_company_employee(u, pk)
        out = svc.employee_out(e)
        if u.is_owner:
            out["salary_config"] = svc.salary_config_out(svc.current_salary_config(e))
        return Response(out)

    def put(self, request, pk):
        return Response(svc.update_employee(request.user, pk, request.data))

    def delete(self, request, pk):
        if not request.user.is_owner:
            raise forbidden("Akses ditolak: khusus Owner")
        return Response(svc.set_status(request.user, pk, "inactive"))


class EmployeeActivateView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.set_status(request.user, pk, "active"))
