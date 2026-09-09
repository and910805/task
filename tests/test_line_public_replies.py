import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from routes import line


class PublicLineReplyTest(unittest.TestCase):
    def test_unknown_customer_message_gets_human_follow_up_ack(self):
        with patch.object(line, "reply_text") as reply:
            line._handle_public_text("reply-token", "我家浴室一直漏水")

        reply.assert_called_once_with(
            "reply-token",
            line._public_ack_text(),
            channel="public",
        )
        response = reply.call_args.args[1]
        self.assertIn("已收到您的訊息", response)
        self.assertIn("專人", response)
        self.assertNotIn("可輸入", response)

    def test_known_commands_keep_their_existing_behavior(self):
        with patch.object(line, "reply_text") as reply:
            line._handle_public_text("reply-token", "服務項目")

        reply.assert_called_once_with(
            "reply-token",
            line._public_services_text(),
            channel="public",
        )


if __name__ == "__main__":
    unittest.main()
