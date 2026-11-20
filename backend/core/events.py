"""Audit log + in-app notifications, written in the same transaction as the
business change that caused them."""
from accounts.models import AuditLog, Profile
from notifications.models import Notification

from .context import get_settings


def audit(user, action, entity, entity_id, summary, details=None):
    return AuditLog.objects.create(company_id=user.company_id, actor_id=user.profile.id, actor_name=user.full_name,
                                   action=action, entity=entity, entity_id=str(entity_id) if entity_id else None,
                                   summary=summary, details=details)


def notify(company_id, recipient_id, type, title, message, link=None):
    if not recipient_id:
        return None
    return Notification.objects.create(company_id=company_id, recipient_id=recipient_id, type=type,
                                       title=title, message=message, link=link)


def owner_ids(company_id):
    return list(Profile.objects.filter(company_id=company_id, role="owner", is_active=True).values_list("id", flat=True))


def notify_owners(company, type, title, message, link=None, pref=None):
    """Owner notifications respect Settings → Notifikasi (``pref`` key)."""
    if pref:
        prefs = get_settings(company).notification_prefs or {}
        if prefs.get(pref) is False:
            return []
    return [notify(company.id, oid, type, title, message, link) for oid in owner_ids(company.id)]


def notify_employee(employee, type, title, message, link=None):
    """Employees are notified only if their account is linked and active."""
    if employee is None or not employee.profile_id:
        return None
    return notify(employee.company_id, employee.profile_id, type, title, message, link)
