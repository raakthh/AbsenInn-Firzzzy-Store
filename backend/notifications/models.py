import uuid

from django.db import models

from accounts.models import Company, Profile


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    recipient = models.ForeignKey(Profile, on_delete=models.CASCADE, db_column="recipient_id")
    type = models.TextField()
    title = models.TextField()
    message = models.TextField()
    link = models.TextField(null=True)
    read_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "notifications"


class Announcement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    title = models.TextField()
    body = models.TextField()
    pinned = models.BooleanField(default=False)
    created_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="created_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "announcements"
