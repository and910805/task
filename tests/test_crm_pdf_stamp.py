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
    def test_stamp_keeps_original_size_when_blank_rows_can_hold_it(self):
        stamp_w = 42 * mm
        stamp_h = 31 * mm
        safe_box = {
            "left_x": 100 * mm,
            "right_x": 160 * mm,
            "bottom_y": 40 * mm,
            "top_y": 88 * mm,
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

        self.assertEqual(fitted_w, stamp_w)
        self.assertEqual(fitted_h, stamp_h)
        self.assertGreaterEqual(center_y - fitted_half_h, safe_box["bottom_y"] + (1 * mm) - 0.01)
        self.assertLessEqual(center_y + fitted_half_h, safe_box["top_y"] - (1 * mm) + 0.01)

    def test_stamp_is_not_placed_when_blank_rows_are_short(self):
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

        self.assertIsNone(placement)

    def test_full_last_page_gets_extra_blank_rows_for_stamp(self):
        self.assertEqual(crm._quote_pdf_item_row_count(20, 20), 40)
        self.assertEqual(crm._quote_pdf_item_row_count(37, 20), 60)
        self.assertEqual(crm._quote_pdf_item_row_count(40, 20), 60)

    def test_partial_last_page_keeps_current_page_when_stamp_rows_fit(self):
        self.assertEqual(crm._quote_pdf_item_row_count(16, 20), 20)
        self.assertEqual(crm._quote_pdf_item_row_count(15, 20), 20)
        self.assertEqual(crm._quote_pdf_item_row_count(21, 20), 40)

    def test_reserved_blank_rows_are_taller_for_stamp(self):
        row_heights = crm._quote_pdf_row_heights(16, 20, 20)

        self.assertEqual(len(row_heights), 22)
        self.assertEqual(row_heights[16], crm.QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm)
        self.assertEqual(row_heights[17], crm.QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm)
        self.assertEqual(row_heights[20], crm.QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm)
        self.assertEqual(row_heights[21], crm.QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm)


if __name__ == "__main__":
    unittest.main()
