import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models

from accounts.models import Company, Profile
from employees.models import Employee


class AttendanceRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    attendance_date = models.DateField()
    check_in_at = models.DateTimeField(null=True)
    check_out_at = models.DateTimeField(null=True)
    work_minutes = models.IntegerField(null=True)
    status = models.TextField()
    location_status = models.TextField(null=True)
    source = models.TextField(default="app")
    leave_request = models.ForeignKey("leave_management.LeaveRequest", null=True, on_delete=models.SET_NULL, db_column="leave_request_id")
    flags = ArrayField(models.TextField(), default=list)
    notes = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "attendance_records"


class AttendanceEvidence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    attendance = models.OneToOneField(AttendanceRecord, on_delete=models.CASCADE, db_column="attendance_id", related_name="evidence")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    attendance_date = models.DateField()
    check_in_selfie_path = models.TextField(null=True)
    check_out_selfie_path = models.TextField(null=True)
    check_in_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    check_in_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    check_out_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    check_out_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True)
    check_in_accuracy_m = models.DecimalField(max_digits=8, decimal_places=2, null=True)
    check_out_accuracy_m = models.DecimalField(max_digits=8, decimal_places=2, null=True)
    check_in_distance_m = models.DecimalField(max_digits=10, decimal_places=2, null=True)
    check_out_distance_m = models.DecimalField(max_digits=10, decimal_places=2, null=True)
    location_status = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "attendance_evidence"


class AttendanceCorrection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    attendance = models.ForeignKey(AttendanceRecord, null=True, on_delete=models.SET_NULL, db_column="attendance_id", related_name="corrections")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    attendance_date = models.DateField()
    source = models.TextField()
    status = models.TextField(default="pending")
    requested_check_in = models.TimeField(null=True)
    requested_check_out = models.TimeField(null=True)
    before_data = models.JSONField(null=True)
    after_data = models.JSONField(null=True)
    reason = models.TextField()
    owner_notes = models.TextField(null=True)
    requested_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="requested_by", related_name="+")
    resolved_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="resolved_by", related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True)

    class Meta:
        managed = False
        db_table = "attendance_corrections"
