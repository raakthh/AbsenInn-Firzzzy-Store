import uuid

from django.db import models

from accounts.models import Company, Profile


class Employee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    profile = models.OneToOneField(Profile, null=True, on_delete=models.SET_NULL, db_column="profile_id", related_name="employee")
    employee_code = models.TextField(blank=True, default="")      # trigger assigns EMP-xxx when empty
    full_name = models.TextField()
    nickname = models.TextField(null=True)
    email = models.TextField()
    phone = models.TextField(null=True)
    address = models.TextField(null=True)
    photo_path = models.TextField(null=True)
    position = models.TextField()
    employment_type = models.TextField(default="Tetap")
    join_date = models.DateField()
    employment_status = models.TextField(default="active")
    avatar_color = models.TextField(default="#6C55F2")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "employees"


class EmploymentHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id", related_name="history")
    event_date = models.DateField()
    event = models.TextField()
    created_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="created_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "employment_history"
