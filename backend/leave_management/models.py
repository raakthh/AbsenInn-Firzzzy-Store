import uuid

from django.db import models

from accounts.models import Company, Profile
from employees.models import Employee


class LeaveType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    code = models.TextField()
    name = models.TextField()
    name_en = models.TextField(null=True)
    is_paid = models.BooleanField(default=True)
    uses_quota = models.BooleanField(default=False)
    requires_attachment = models.BooleanField(default=False)
    half_day = models.BooleanField(default=False)
    attendance_status = models.TextField()
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "leave_types"


class LeaveRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, db_column="leave_type_id")
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    attachment_path = models.TextField(null=True)
    status = models.TextField(default="pending")
    owner_notes = models.TextField(null=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True)
    decided_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="decided_by")

    class Meta:
        managed = False
        db_table = "leave_requests"
