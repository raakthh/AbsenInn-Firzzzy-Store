"""Company, profiles and company-wide configuration.
All tables are created by database/migrations/*.sql — managed = False."""
import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models


class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.TextField()
    address = models.TextField(null=True, blank=True)
    phone = models.TextField(null=True, blank=True)
    email = models.TextField(null=True, blank=True)
    logo_path = models.TextField(null=True, blank=True)
    timezone = models.TextField(default="Asia/Jakarta")
    email_domain = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "companies"


class Profile(models.Model):
    """1:1 with auth.users (Supabase Auth). id == JWT ``sub``."""
    id = models.UUIDField(primary_key=True)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    role = models.TextField()
    full_name = models.TextField()
    email = models.TextField()
    avatar_color = models.TextField(default="#6C55F2")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "profiles"


class CompanySettings(models.Model):
    company = models.OneToOneField(Company, primary_key=True, on_delete=models.CASCADE, db_column="company_id", related_name="settings")
    selfie_required = models.BooleanField(default=True)
    gps_required = models.BooleanField(default=True)
    max_gps_accuracy_m = models.IntegerField(default=100)
    payroll_period = models.TextField(default="monthly")
    payment_day_mode = models.TextField(default="fixed")
    default_payment_day = models.SmallIntegerField(null=True)
    payroll_rules = models.JSONField(default=dict)
    default_components = models.JSONField(default=list)
    annual_leave_quota_days = models.SmallIntegerField(default=12)
    leave_approval = models.TextField(default="owner")
    notification_prefs = models.JSONField(default=dict)
    profile_editable_fields = ArrayField(models.TextField(), default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "company_settings"


class WorkSchedule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    name = models.TextField(default="Jadwal Utama")
    work_start = models.TimeField()
    work_end = models.TimeField()
    break_start = models.TimeField(null=True)
    break_end = models.TimeField(null=True)
    working_days = ArrayField(models.SmallIntegerField())     # 0 = Minggu … 6 = Sabtu
    late_tolerance_min = models.SmallIntegerField(default=10)
    early_leave_tolerance_min = models.SmallIntegerField(default=0)
    is_default = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "work_schedules"


class WorkLocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    name = models.TextField()
    address = models.TextField(null=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    radius_m = models.IntegerField(default=100)
    is_primary = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "work_locations"


class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    actor = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="actor_id")
    actor_name = models.TextField(null=True)
    action = models.TextField()
    entity = models.TextField()
    entity_id = models.TextField(null=True)
    summary = models.TextField()
    details = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "audit_logs"
