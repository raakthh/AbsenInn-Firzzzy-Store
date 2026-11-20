"""python manage.py send_reminders  — run every 15–30 minutes (cron / Render Cron Job / GitHub Actions)."""
import json

from django.core.management.base import BaseCommand
from django.db import transaction

from notifications import reminders


class Command(BaseCommand):
    help = "Kirim pengingat terjadwal (check-in, check-out, deadline tugas, gajian). Aman dijalankan berulang."

    def handle(self, *args, **opts):
        with transaction.atomic():
            result = reminders.run()
        self.stdout.write(json.dumps({"sent": result}))
