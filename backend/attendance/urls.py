from django.urls import path

from . import views as v

urlpatterns = [
    path("history/", v.HistoryView.as_view()),
    path("monitoring/", v.MonitoringView.as_view()),
    path("today/", v.TodayView.as_view()),
    path("location-preview/", v.LocationPreviewView.as_view()),
    path("check-in/", v.CheckInView.as_view()),
    path("check-out/", v.CheckOutView.as_view()),
    path("correction-requests/", v.CorrectionRequestsView.as_view()),
    path("correction-requests/<str:pk>/<str:decision>/", v.ResolveCorrectionView.as_view()),
    path("reconcile/", v.ReconcileView.as_view()),
    path("<str:pk>/", v.DetailView.as_view()),
    path("<str:pk>/evidence/", v.EvidenceView.as_view()),
    path("<str:pk>/correction/", v.CorrectView.as_view()),
]
