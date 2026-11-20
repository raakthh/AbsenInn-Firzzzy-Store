from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsEmployee, IsOwner

from . import services as svc


class TypesView(APIView):
    def get(self, request):
        return Response(svc.types(request.user))


class ListView(APIView):
    def get(self, request):
        return Response(svc.list_requests(request.user, request.query_params))


class DetailView(APIView):
    def get(self, request, pk):
        return Response(svc.get_request(request.user, pk))


class RequestView(APIView):
    """JSON, or multipart/form-data with an ``attachment`` file (PDF/JPG/PNG ≤ 5 MB)."""
    permission_classes = [IsEmployee]

    def post(self, request):
        return Response(svc.request_leave(request.user, request.data, request.FILES.get("attachment")), status=201)


class ApproveView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.decide(request.user, pk, "approved", request.data.get("notes")))


class RejectView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.decide(request.user, pk, "rejected", request.data.get("notes")))


class CancelView(APIView):
    permission_classes = [IsEmployee]

    def post(self, request, pk):
        return Response(svc.cancel(request.user, pk))


class AttachmentView(APIView):
    def get(self, request, pk):
        return Response(svc.attachment_url(request.user, pk))


class BalanceView(APIView):
    def get(self, request):
        return Response(svc.balance(request.user, request.query_params.get("employee_id")))
