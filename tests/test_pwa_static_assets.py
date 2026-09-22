import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


class PwaStaticAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _request_results(self):
        environment = os.environ.copy()
        environment.update(
            {
                "DATABASE_URL": f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}",
                "SECRET_KEY": "test-secret",
                "JWT_SECRET_KEY": "test-jwt-secret",
                "UPLOAD_FOLDER": str(Path(self.temp_dir.name) / "uploads"),
                "INIT_DB_ON_STARTUP": "0",
            }
        )
        script = """
import json
from app import create_app
from extensions import db

app = create_app()
app.config.update(TESTING=True)
client = app.test_client()
paths = [
    '/manifest.webmanifest',
    '/sw.js',
    '/offline.html',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png',
    '/icons/not-an-icon.png',
]
results = {}
for path in paths:
    response = client.get(path, buffered=True)
    results[path] = {
        'status': response.status_code,
        'content_type': response.content_type,
        'cache_control': response.headers.get('Cache-Control'),
        'json': response.get_json(silent=True),
    }
with app.app_context():
    db.session.remove()
    db.engine.dispose()
print(json.dumps(results))
"""
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=BACKEND,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def test_pwa_control_files_are_served_directly_with_no_cache(self):
        results = self._request_results()

        for path, content_type in (
            ("/manifest.webmanifest", "manifest"),
            ("/sw.js", "javascript"),
        ):
            with self.subTest(path=path):
                response = results[path]
                self.assertEqual(response["status"], 200)
                self.assertIn(content_type, response["content_type"])
                self.assertEqual(response["cache_control"], "no-cache")

    def test_offline_page_and_icons_are_served_as_static_assets(self):
        results = self._request_results()

        self.assertEqual(results["/offline.html"]["status"], 200)
        self.assertIn("text/html", results["/offline.html"]["content_type"])

        for icon in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
            with self.subTest(icon=icon):
                response = results[f"/icons/{icon}"]
                self.assertEqual(response["status"], 200)
                self.assertEqual(response["content_type"], "image/png")

    def test_unknown_icon_never_falls_back_to_the_spa(self):
        response = self._request_results()["/icons/not-an-icon.png"]

        self.assertEqual(response["status"], 404)
        self.assertEqual(response["json"], {"error": "Not found"})
