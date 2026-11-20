from django.urls import path

from . import views as v

urlpatterns = [path("performance/", v.PerformanceView.as_view())]
