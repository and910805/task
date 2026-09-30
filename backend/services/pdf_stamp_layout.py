"""Stamp placement against actual ReportLab table fragments, in PDF points."""

import base64
import hashlib
import json
import math
import threading
from io import BytesIO

from reportlab.platypus import Table

_RENDER_LOCK = threading.Lock()


class StampLayoutError(ValueError):
    pass


def cell_text(value):
    if hasattr(value, "getPlainText"):
        return value.getPlainText()
    if hasattr(value, "_content"):
        return cell_text(value._content)
    if isinstance(value, (tuple, list)):
        return "".join(cell_text(item) for item in value)
    return str(value or "")


class StampLayoutTable(Table):
    def draw(self):
        layout = getattr(self.canv, "stamp_layout", None)
        if layout is not None:
            x, y = self.canv.absolutePosition(0, 0)
            top = y + sum(self._rowHeights)
            for row, height in zip(self._cellvalues, self._rowHeights):
                values = [cell_text(v) for v in row]
                # Numbered rows are the only editable stamp surface, not totals/headers.
                if values[0].isdigit():
                    cells = []
                    left = x
                    for index, (value, width) in enumerate(zip(values, self._colWidths)):
                        zero_price = index in (5, 6) and value.strip() in ("0", "0.00", "")
                        cells.append({"box": [left, top - height, left + width, top],
                                      "protected": bool(value.strip()) and not zero_price,
                                      "text": value})
                        left += width
                    layout["rows"].append({"page": self.canv.getPageNumber(), "cells": cells})
                top -= height
        super().draw()


def fingerprint(layout):
    content = {k: layout[k] for k in ("rows", "stamp", "pages")}
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def validate_position(position, layout):
    if not isinstance(position, dict):
        raise StampLayoutError("印章位置格式錯誤。")
    if not layout.get("stamp"):
        raise StampLayoutError("尚未設定公司印章。")
    if position.get("fingerprint") != fingerprint(layout):
        raise StampLayoutError("單據版面已變更，請重新預覽並確認印章位置。")
    page, x, y = position.get("page"), position.get("x"), position.get("y")
    if (type(page) is not int or page < 1 or page > layout["pages"]
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in (x, y))):
        raise StampLayoutError("印章頁碼或座標無效。")
    stamp = layout["stamp"]
    half_w, half_h = stamp["width"] / 2, stamp["height"] / 2
    box = [x - half_w, y - half_h, x + half_w, y + half_h]
    rows = [row for row in layout["rows"] if row["page"] == page]
    # Check complete vertical coverage by body rows, not just the outer bounding box.
    intervals = []
    for row in rows:
        cells = row["cells"]
        left, bottom, _, top = cells[0]["box"]
        right = cells[-1]["box"][2]
        if box[0] >= left and box[2] <= right and top > box[1] and bottom < box[3]:
            intervals.append((max(bottom, box[1]), min(top, box[3])))
        for cell in cells:
            a, b, c, d = cell["box"]
            if cell["protected"] and box[0] < c and box[2] > a and box[1] < d and box[3] > b:
                raise StampLayoutError("印章會遮住文字或非零金額，請移到空白或零元區域。")
    covered = sum(max(0, end - start) for start, end in intervals)
    if covered < stamp["height"] - 0.01:
        raise StampLayoutError("印章必須完整放在表格明細區內。")
    return {"center_x": x, "center_y": y, "target_page": page, "apply_y_offset": False}


def render_page(pdf_bytes, page_number):
    import pypdfium2 as pdfium

    # PDFium is not thread-safe, including across independent documents.
    with _RENDER_LOCK:
        with pdfium.PdfDocument(pdf_bytes) as pdf:
            if page_number < 1 or page_number > len(pdf):
                raise StampLayoutError("頁碼不存在。")
            page = pdf[page_number - 1]
            bitmap = page.render(scale=1.5)
            try:
                image = bitmap.to_pil()
                output = BytesIO()
                image.save(output, format="PNG")
                return base64.b64encode(output.getvalue()).decode("ascii")
            finally:
                bitmap.close()
                page.close()
