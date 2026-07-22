import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from routes import crm


class CrmDownloadCacheTest(unittest.TestCase):
    def _item(self, description):
        return SimpleNamespace(
            id=1,
            sort_order=0,
            description=description,
            unit="unit",
            note=None,
            quantity=1,
            unit_price=100,
            amount=100,
        )

    def test_datetime_cache_token_preserves_microseconds(self):
        first = datetime(2026, 7, 22, 12, 0, 0, 1)
        second = datetime(2026, 7, 22, 12, 0, 0, 2)

        self.assertNotEqual(crm._cache_datetime_token(first), crm._cache_datetime_token(second))

    def test_item_text_change_invalidates_download_cache_token(self):
        before = crm._line_items_cache_token([self._item("old description")])
        after = crm._line_items_cache_token([self._item("new description")])

        self.assertNotEqual(before, after)


if __name__ == "__main__":
    unittest.main()
