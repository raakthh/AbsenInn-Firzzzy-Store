"""API routes. Paths match frontend/js/api.js (API_BASE_URL = .../api)."""
from django.urls import include, path

from accounts import views as acc
from employees import views as emp
from notifications import views as nt

api = [
    path("health/", acc.HealthView.as_view()),
    path("auth/me/", acc.MeView.as_view()),
    path("settings/", acc.SettingsView.as_view()),
    path("settings/<str:section>/", acc.SettingsSectionView.as_view()),
    path("audit-logs/", acc.AuditLogView.as_view()),

    path("employees/", emp.EmployeeListView.as_view()),
    path("employees/<str:pk>/", emp.EmployeeDetailView.as_view()),
    path("employees/<str:pk>/activate/", emp.EmployeeActivateView.as_view()),

    path("notifications/", nt.NotificationListView.as_view()),
    path("notifications/unread-count/", nt.UnreadCountView.as_view()),
    path("notifications/read-all/", nt.NotificationReadAllView.as_view()),
    path("notifications/<str:pk>/read/", nt.NotificationReadView.as_view()),
    path("announcements/", nt.AnnouncementListView.as_view()),
    path("announcements/<str:pk>/", nt.AnnouncementDetailView.as_view()),
    path("cron/reminders/", nt.CronRemindersView.as_view()),

    path("attendance/", include("attendance.urls")),
    path("leave/", include("leave_management.urls")),
    path("tasks/", include("task_management.urls")),
    path("payroll/", include("payroll.urls")),
    path("analytics/", include("analytics.urls")),
]

urlpatterns = [path("api/", include(api))]
