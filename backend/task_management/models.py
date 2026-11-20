import uuid

from django.db import models
from django.db.models.functions import Now

from accounts.models import Company, Profile
from employees.models import Employee


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    title = models.TextField()
    description = models.TextField(null=True)
    priority = models.TextField(default="medium")
    deadline = models.DateField()
    status = models.TextField(default="todo")
    progress = models.SmallIntegerField(default=0)
    created_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="created_by")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        managed = False
        db_table = "tasks"


class TaskAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, db_column="task_id", related_name="assignments")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "task_assignments"


class TaskHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, db_column="task_id", related_name="history")
    actor = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="actor_id")
    action = models.TextField()
    from_status = models.TextField(null=True)
    to_status = models.TextField(null=True)
    progress = models.SmallIntegerField(null=True)
    created_at = models.DateTimeField(db_default=Now())   # DB clock, same source as the history trigger

    class Meta:
        managed = False
        db_table = "task_history"
