import os
import shutil
import tempfile
from io import StringIO
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase


class FrontendConfigTests(SimpleTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()) / "config.js"
        shutil.copy(Path(settings.PROJECT_DIR) / "frontend/js/config.js", self.tmp)

    def run_cmd(self, **env):
        with mock.patch.dict(os.environ, env, clear=False):
            call_command("write_frontend_config", path=str(self.tmp), stdout=StringIO())
        return self.tmp.read_text()

    def test_repo_stays_demo_by_default(self):
        self.assertIn("MODE: 'demo'", (Path(settings.PROJECT_DIR) / "frontend/js/config.js").read_text())
        with mock.patch.dict(os.environ, {"FRONTEND_MODE": "demo"}):
            self.assertIn("MODE: 'demo'", self.run_cmd())

    def test_production_rewrite(self):
        out = self.run_cmd(FRONTEND_MODE="production", SUPABASE_URL="https://abc.supabase.co/", SUPABASE_ANON_KEY="pub-key-123", SUPABASE_SERVICE_ROLE_KEY="srv")
        self.assertIn("MODE: 'production'", out)
        self.assertIn("SUPABASE_URL: 'https://abc.supabase.co'", out)
        self.assertIn("SUPABASE_ANON_KEY: 'pub-key-123'", out)
        self.assertIn("API_BASE_URL: '/api'", out)
        self.assertIn("DEMO_STORAGE_KEY", out)          # rest of file untouched

    def test_refuses_missing_or_secret_key(self):
        with self.assertRaises(CommandError):
            self.run_cmd(FRONTEND_MODE="production", SUPABASE_URL="https://abc.supabase.co", SUPABASE_ANON_KEY="")
        with self.assertRaises(CommandError):
            self.run_cmd(FRONTEND_MODE="production", SUPABASE_URL="https://abc.supabase.co", SUPABASE_ANON_KEY="same", SUPABASE_SERVICE_ROLE_KEY="same")
