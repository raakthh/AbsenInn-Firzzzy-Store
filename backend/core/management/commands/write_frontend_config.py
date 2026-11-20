"""Switch the served frontend to production at container start.

The Git repository always ships ``frontend/js/config.js`` in **demo** mode (safe for the public
portfolio and GitHub Pages). The real deployment sets FRONTEND_MODE=production plus the public
Supabase values, and the Docker CMD runs this command before gunicorn starts, so the file inside
the container is rewritten. Nothing is committed and the repository stays a demo.

    FRONTEND_MODE=production SUPABASE_URL=... SUPABASE_ANON_KEY=... python manage.py write_frontend_config
"""
import json
import os
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Tulis nilai produksi (MODE, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL) ke frontend/js/config.js"

    def add_arguments(self, parser):
        parser.add_argument("--path", default=str(Path(settings.PROJECT_DIR) / "frontend" / "js" / "config.js"))

    def handle(self, *args, path, **opts):
        mode = os.environ.get("FRONTEND_MODE", "demo").strip().lower()
        if mode != "production":
            self.stdout.write("FRONTEND_MODE bukan 'production' — config.js dibiarkan (mode demo).")
            return
        values = {"MODE": "production", "SUPABASE_URL": os.environ.get("SUPABASE_URL", "").rstrip("/"),
                  "SUPABASE_ANON_KEY": os.environ.get("SUPABASE_ANON_KEY", ""), "API_BASE_URL": os.environ.get("FRONTEND_API_BASE_URL", "/api")}
        if not values["SUPABASE_URL"] or not values["SUPABASE_ANON_KEY"]:
            raise CommandError("FRONTEND_MODE=production membutuhkan SUPABASE_URL dan SUPABASE_ANON_KEY")
        if "service_role" in values["SUPABASE_ANON_KEY"] or values["SUPABASE_ANON_KEY"] == os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
            raise CommandError("SUPABASE_ANON_KEY tidak boleh berisi service role key")
        p = Path(path)
        text = p.read_text(encoding="utf-8")
        for key, val in values.items():
            text, n = re.subn(rf"^(\s*{key}:\s*)'[^']*'", lambda m: m.group(1) + json.dumps(val).replace('"', "'"), text, count=1, flags=re.M)
            if n != 1:
                raise CommandError(f"Tidak menemukan {key} di {p}")
        p.write_text(text, encoding="utf-8")
        self.stdout.write(f"config.js → production ({values['SUPABASE_URL']})")
