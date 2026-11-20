from django.urls import path

from . import views as v

urlpatterns = [
    path("", v.ListView.as_view()),
    path("<str:pk>/", v.DetailView.as_view()),
    path("<str:pk>/status/", v.StatusView.as_view()),
]
