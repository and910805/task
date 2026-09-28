import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1] / "backend"


class IosMobileOriginTest(unittest.TestCase):
    def test_mobile_origin_allows_login_preflight_with_custom_web_origins(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment.update(
                {
                    "DATABASE_URL": f"sqlite:///{Path(directory) / 'test.db'}",
                    "SECRET_KEY": "test-secret",
                    "JWT_SECRET_KEY": "test-jwt-secret",
                    "UPLOAD_FOLDER": str(Path(directory) / "uploads"),
                    "INIT_DB_ON_STARTUP": "0",
                    "CORS_ORIGINS": "https://task.kuanlin.online",
                }
            )
            script = """
import json
from app import _parse_cors_origins, create_app

app = create_app()
response = app.test_client().options(
    '/api/auth/login',
    headers={
        'Origin': 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
    },
)
untrusted = app.test_client().options(
    '/api/auth/login',
    headers={
        'Origin': 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
    },
)
print(json.dumps({
    'default_origins': _parse_cors_origins(None),
    'configured_origins': app.config['CORS_ORIGINS'],
    'allow_origin': response.headers.get('Access-Control-Allow-Origin'),
    'allow_headers': response.headers.get('Access-Control-Allow-Headers', ''),
    'untrusted_allow_origin': untrusted.headers.get('Access-Control-Allow-Origin'),
}))
"""
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=BACKEND,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertIn("capacitor://localhost", output["default_origins"])
        self.assertIn("capacitor://localhost", output["configured_origins"])
        self.assertEqual(output["allow_origin"], "capacitor://localhost")
        self.assertIn("authorization", output["allow_headers"].lower())
        self.assertIsNone(output["untrusted_allow_origin"])


if __name__ == "__main__":
    unittest.main()
