from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import forbidden

from . import services as svc


class ListView(APIView):
    def get(self, request):
        return Response(svc.list_tasks(request.user, request.query_params))

    def post(self, request):
        if not request.user.is_owner:
            raise forbidden("Akses ditolak: khusus Owner")
        return Response(svc.save_task(request.user, None, request.data), status=201)


class DetailView(APIView):
    def get(self, request, pk):
        return Response(svc.get_task(request.user, pk))

    def put(self, request, pk):
        if not request.user.is_owner:
            raise forbidden("Akses ditolak: khusus Owner")
        return Response(svc.save_task(request.user, pk, request.data))

    def delete(self, request, pk):
        if not request.user.is_owner:
            raise forbidden("Akses ditolak: khusus Owner")
        return Response(svc.delete_task(request.user, pk))


class StatusView(APIView):
    def patch(self, request, pk):
        return Response(svc.set_status(request.user, pk, request.data.get("status"), request.data.get("progress")))
