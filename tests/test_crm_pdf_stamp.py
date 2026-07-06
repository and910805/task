import math
import sys
import unittest
from pathlib import Path

from reportlab.lib.units import mm

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from routes import crm


class QuotePdfStampPlacementTest(unittest.TestCase):
    def test_stamp_is_scaled_to_stay_inside_blank_rows(self):
        stamp_w = 42 * mm
        stamp_h = 31 * mm
        safe_box = {
            "left_x": 100 * mm,
            "right_x": 160 * mm,
            "bottom_y": 40 * mm,
            "top_y": 76 * mm,
        }

        placement = crm._fit_stamp_in_safe_box(
            stamp_w,
            stamp_h,
            90,
            safe_box,
            padding=1 * mm,
        )

        self.assertIsNotNone(placement)
        _, center_y, fitted_w, fitted_h = placement
        _, fitted_half_h = crm._rotated_rect_half_extents(fitted_w, fitted_h, 90)

        self.assertLess(fitted_w, stamp_w)
        self.assertGreaterEqual(center_y - fitted_half_h, safe_box["bottom_y"] + (1 * mm) - 0.01)
        self.assertLessEqual(center_y + fitted_half_h, safe_box["top_y"] - (1 * mm) + 0.01)

    def test_full_last_page_gets_extra_blank_rows_for_stamp(self):
        self.assertEqual(crm._quote_pdf_item_row_count(20, 20), 40)
        self.assertEqual(crm._quote_pdf_item_row_count(40, 20), 60)

    def test_partial_last_page_keeps_current_page(self):
        self.assertEqual(crm._quote_pdf_item_row_count(16, 20), 20)
        self.assertEqual(crm._quote_pdf_item_row_count(21, 20), 40)


if __name__ == "__main__":
    unittest.main()
