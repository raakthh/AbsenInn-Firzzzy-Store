from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsEmployee, IsOwner

from . import services as svc


class HistoryView(APIView):
    def get(self, request):
        return Response(svc.history(request.user, request.query_params))


class MonitoringView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        return Response(svc.monitoring(request.user, request.query_params.get("date")))


class TodayView(APIView):
    permission_classes = [IsEmployee]

    def get(self, request):
        return Response(svc.today_view(request.user))


class LocationPreviewView(APIView):
    permission_classes = [IsEmployee]

    def post(self, request):
        d = request.data
        return Response(svc.location_check(request.user.company, d.get("lat"), d.get("lng"), d.get("accuracy")))


class CheckInView(APIView):
    permission_classes = [IsEmployee]

    def post(self, request):
        return Response(svc.check(request.user, "in", request.data), status=201)


class CheckOutView(APIView):
    permission_classes = [IsEmployee]

    def post(self, request):
        return Response(svc.check(request.user, "out", request.data))


class DetailView(APIView):
    def get(self, request, pk):
        return Response(svc.detail(request.user, pk))


class EvidenceView(APIView):
    def get(self, request, pk):
        return Response(svc.evidence(request.user, pk))


class CorrectView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk):
        return Response(svc.correct(request.user, pk, request.data))


class CorrectionRequestsView(APIView):
    def get(self, request):
        return Response(svc.correction_requests(request.user))

    def post(self, request):
        svc.ensure_employee(request.user)
        return Response(svc.request_correction(request.user, request.data), status=201)


class ResolveCorrectionView(APIView):
    permission_classes = [IsOwner]

    def post(self, request, pk, decision):
        return Response(svc.resolve_correction(request.user, pk, decision, request.data))


class ReconcileView(APIView):
    permission_classes = [IsOwner]

    def get(self, request):
        return Response(svc.reconcile_preview(request.user, request.query_params.get("date")))

    def post(self, request):
        return Response(svc.reconcile(request.user, request.data.get("date"), request.data.get("employee_ids")))
