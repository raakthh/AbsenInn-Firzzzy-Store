from django.urls import path

from . import views as v

urlpatterns = [
    path("", v.ListView.as_view()),
    path("types/", v.TypesView.as_view()),
    path("request/", v.RequestView.as_view()),
    path("balance/", v.BalanceView.as_view()),
    path("<str:pk>/", v.DetailView.as_view()),
    path("<str:pk>/approve/", v.ApproveView.as_view()),
    path("<str:pk>/reject/", v.RejectView.as_view()),
    path("<str:pk>/cancel/", v.CancelView.as_view()),
    path("<str:pk>/attachment/", v.AttachmentView.as_view()),
]
