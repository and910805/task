import math
import sys
import unittest
from io import BytesIO
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

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

    def test_long_note_increases_pdf_item_row_height(self):
        style = getSampleStyleSheet()["Normal"].clone("LongCjkNote")
        style.fontSize = 9.5
        style.leading = 11
        style.wordWrap = "CJK"
        col_widths = [12 * mm, 46 * mm, 28 * mm, 14 * mm, 14 * mm, 20 * mm, 20 * mm, 20 * mm]
        rows = [
            ["項目", "項目名稱", "規格內容", "單位", "數量", "單價", "合計", "備註"],
            ["1", Paragraph("配電盤控制線施工", style), "", "式", "1", "1000", "1000", Paragraph("含盤內控制線等白螺絲配電工膠帶等", style)],
            ["總計", "", "新台幣", "", "", "", "NT$ 1000", ""],
        ]

        item_heights = crm._quote_pdf_item_heights(rows, col_widths, 1)
        row_heights = crm._quote_pdf_row_heights(1, 20, 20, item_heights=item_heights)

        self.assertGreater(item_heights[0], crm.QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm)
        self.assertEqual(row_heights[1], item_heights[0])

    def test_dynamic_height_is_reclaimed_from_unused_blank_rows(self):
        base_height = crm.QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm
        original = crm._quote_pdf_row_heights(1, 20, 20)
        adjusted = crm._quote_pdf_row_heights(
            1,
            20,
            20,
            item_heights=[base_height + (12 * mm)],
        )

        self.assertAlmostEqual(sum(adjusted), sum(original), places=4)
        self.assertGreater(adjusted[1], base_height)
        self.assertGreaterEqual(adjusted[6], crm.QUOTE_PDF_MIN_BLANK_ROW_HEIGHT_MM * mm)
        self.assertLess(adjusted[6], base_height)
        for row_index in range(2, 6):
            self.assertEqual(adjusted[row_index], crm.QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm)

    def test_stamp_box_follows_actual_table_fragment_after_tall_rows(self):
        doc = SimpleDocTemplate(
            BytesIO(),
            pagesize=A4,
            leftMargin=12 * mm,
            rightMargin=12 * mm,
            topMargin=12 * mm,
            bottomMargin=12 * mm,
        )
        col_widths = [12 * mm, 46 * mm, 28 * mm, 14 * mm, 14 * mm, 20 * mm, 20 * mm, 20 * mm]
        rows = [["項目", "項目名稱", "規格內容", "單位", "數量", "單價", "合計", "備註"]]
        for row_no in range(1, 13):
            rows.append([str(row_no), "長內容", "", "式", "1", "", "", ""])
        for row_no in range(13, 17):
            rows.append([str(row_no), "", "", "", "", "", "", ""])
        rows.append(["總計", "", "", "", "", "", "", ""])
        row_heights = [9 * mm] + ([40 * mm] * 12) + ([crm.QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm] * 4) + [9 * mm]
        table = Table(rows, colWidths=col_widths, rowHeights=row_heights, repeatRows=1, hAlign="CENTER")
        table.setStyle(TableStyle([("NOSPLIT", (0, 13), (-1, 16))]))

        safe_box = crm._find_table_label_range_box(
            doc,
            [],
            table,
            first_label="13",
            last_label="16",
            first_col=5,
            last_col=7,
        )

        self.assertIsNotNone(safe_box)
        self.assertGreaterEqual(safe_box["target_page"], 2)
        self.assertAlmostEqual(
            safe_box["top_y"] - safe_box["bottom_y"],
            4 * crm.QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm,
            places=2,
        )


if __name__ == "__main__":
    unittest.main()
