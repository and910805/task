import unittest
from pathlib import Path


class DockerfileStartupTest(unittest.TestCase):
    def test_startup_port_prefers_web_port_and_validates_numeric_value(self):
        dockerfile = Path(__file__).resolve().parents[1] / "Dockerfile"
        content = dockerfile.read_text(encoding="utf-8")

        self.assertIn("APP_PORT", content)
        self.assertIn("WEB_PORT", content)
        self.assertIn("*[!0-9]*", content)
        self.assertIn("0.0.0.0:${APP_PORT}", content)


if __name__ == "__main__":
    unittest.main()
