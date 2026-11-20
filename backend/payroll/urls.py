from django.urls import path

from . import views as v

urlpatterns = [
    path("", v.PeriodListView.as_view()),
    path("generate/", v.GenerateView.as_view()),
    path("my-payslips/", v.MyPayslipsView.as_view()),
    path("salary-configurations/", v.SalaryConfigListView.as_view()),
    path("salary-configurations/<str:emp_id>/", v.SalaryConfigDetailView.as_view()),
    path("employees/<str:emp_id>/items/", v.EmployeeItemsView.as_view()),
    path("items/<str:pk>/", v.ItemView.as_view()),
    path("items/<str:pk>/pdf/", v.ItemPdfView.as_view()),
    path("items/<str:pk>/adjustments/", v.AdjustmentListView.as_view()),
    path("items/<str:pk>/adjustments/<str:adj>/", v.AdjustmentDetailView.as_view()),
    path("<str:pk>/", v.PeriodDetailView.as_view()),
    path("<str:pk>/recalculate/", v.RecalculateView.as_view()),
    path("<str:pk>/confirm-payment/", v.ConfirmPaymentView.as_view()),
    path("<str:pk>/<str:action>/", v.TransitionView.as_view()),
]
