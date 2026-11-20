import uuid

from django.db import models

from accounts.models import Company, Profile
from employees.models import Employee


class PayrollPeriod(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    period_key = models.TextField()
    start_date = models.DateField()
    end_date = models.DateField()
    payment_date = models.DateField(null=True)
    status = models.TextField(default="draft")
    approved_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="approved_by")
    approved_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "payroll_periods"


class SalaryComponent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    name = models.TextField()
    kind = models.TextField()
    default_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "salary_components"


class SalaryConfiguration(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id", related_name="salary_configs")
    basic_salary = models.DecimalField(max_digits=14, decimal_places=2)
    allowances = models.JSONField(default=list)
    overtime_rate_per_hour = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    pay_day = models.SmallIntegerField(null=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "employee_salary_configurations"


class PayrollItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    period = models.ForeignKey(PayrollPeriod, on_delete=models.CASCADE, db_column="period_id", related_name="items")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    cycle_start = models.DateField()
    cycle_end = models.DateField()
    payment_date = models.DateField()
    basic_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    allowances = models.JSONField(default=list)
    bonus = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    incentives = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    overtime_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    overtime_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    deductions = models.JSONField(default=list)
    net_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.TextField(default="draft")
    calc_snapshot = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "payroll_items"


class PayrollAdjustment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    payroll_item = models.ForeignKey(PayrollItem, on_delete=models.CASCADE, db_column="payroll_item_id", related_name="adjustments")
    type = models.TextField()
    name = models.TextField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    created_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="created_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "payroll_adjustments"


class Payment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    payroll_item = models.OneToOneField(PayrollItem, on_delete=models.CASCADE, db_column="payroll_item_id", related_name="payment")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    paid_at = models.DateTimeField()
    method = models.TextField()
    reference = models.TextField(null=True)
    note = models.TextField(null=True)
    confirmed_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL, db_column="confirmed_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "payments"


class Payslip(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, db_column="company_id")
    payroll_item = models.OneToOneField(PayrollItem, on_delete=models.CASCADE, db_column="payroll_item_id", related_name="payslip")
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, db_column="employee_id")
    file_path = models.TextField(null=True)
    generated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = "payslips"
