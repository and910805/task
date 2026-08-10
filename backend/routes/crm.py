from __future__ import annotations

from datetime import date, datetime, time, timedelta
from io import BytesIO
from collections import OrderedDict
from copy import copy
import glob
import hashlib
import json
import math
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unicodedata
from xml.sax.saxutils import escape

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_jwt_extended import jwt_required
from openpyxl import load_workbook
from sqlalchemy import func, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from decorators import role_required
from extensions import db
from models import (
    Contact,
    Contract,
    ContractVersion,
    Customer,
    AuditLog,
    Invoice,
    InvoiceItem,
    InvoicePaymentRecord,
    Quote,
    QuoteItem,
    QuoteVersion,
    ServiceCatalogItem,
    SiteSetting,
    Task,
    WebsiteBooking,
)
from utils import get_current_user_id
from services.attachments import replace_signature_file
from rate_limit import rate_limit

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Image, KeepInFrame, PageBreak, SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

crm_bp = Blueprint("crm", __name__)

READ_ROLES = ("site_supervisor", "hq_staff", "admin")
WRITE_ROLES = ("site_supervisor", "hq_staff", "admin")
VALID_QUOTE_STATUS = {"draft", "sent", "accepted", "rejected", "expired"}
VALID_INVOICE_STATUS = {"draft", "issued", "partially_paid", "paid", "cancelled"}
VALID_CONTRACT_STATUS = {"draft", "ready", "signed", "cancelled"}
VALID_WEBSITE_BOOKING_TYPES = {"booking", "quote", "contact"}
VALID_WEBSITE_BOOKING_STATUS = {"pending", "contacted", "quoted", "converted", "closed"}
DEFAULT_QUOTE_VALID_DAYS = 10

PDF_FONT_NAME = "Helvetica"
PDF_FONT_ENV = "PDF_FONT_PATH"
CONTRACT_PDF_FONT_NAME = "ContractSerif"
CONTRACT_PDF_FONT_ENV = "CONTRACT_PDF_FONT_PATH"
CONTRACT_PDF_FONT_CANDIDATES = (
    "/usr/local/share/fonts/NotoSerifTC-wght.ttf",
    "C:/Windows/Fonts/NotoSerifTC-VF.ttf",
    "C:/Windows/Fonts/kaiu.ttf",
)
PDF_FONT_CANDIDATES = (
    "/usr/local/share/fonts/NotoSerifTC-wght.ttf",
    "/usr/local/share/fonts/NotoSansTC-wght.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansTW-Regular.otf",
    "C:/Windows/Fonts/NotoSansTC-VF.ttf",
    "C:/Windows/Fonts/NotoSerifTC-VF.ttf",
    "C:/Windows/Fonts/msjh.ttc",
    "C:/Windows/Fonts/mingliu.ttc",
    "C:/Windows/Fonts/kaiu.ttf",
)
PDF_CID_FALLBACKS = ("MSung-Light", "STSong-Light")
PDF_REQUIRE_EMBEDDED_FONT_ENV = "PDF_REQUIRE_EMBEDDED_FONT"
# Use unicode escapes to avoid source-file encoding issues on Windows/editors.
PDF_CJK_PROBE = "\u4f30\u50f9\u55ae\u767c\u7968\u53f0\u7167"  # ???????
PDF_FONT_SOURCE = "default"
PDF_FONT_PATH_USED = ""
PDF_STAMP_ENV = "PDF_STAMP_IMAGE_PATH"
PDF_STAMP_DEFAULT_FILENAME = "S__5505135-removebg-preview.png"
PDF_STAMP_ROTATE_ENV = "PDF_STAMP_ROTATE_DEG"
PDF_STAMP_DEFAULT_ROTATE_DEG = 90.0
PDF_STAMP_WIDTH_MM = 24.0 * 1.35 * 1.30
PDF_STAMP_Y_OFFSET_ENV = "PDF_STAMP_Y_OFFSET_MM"
PDF_STAMP_DEFAULT_Y_OFFSET_MM = 10.0
PDF_COMPANY_TAX_ID_TEXT = "\u7acb\u7fd4\u6c34\u96fb\u7d71\u7de8 14511159"
DEFAULT_CONTRACT_PAYMENT_TERMS = "簽約訂金 30%；工程進度款 40%；驗收完成後支付尾款 30%。"
DEFAULT_CONTRACT_WARRANTY_MONTHS = 12
CRM_DOWNLOAD_CACHE_MAX_ITEMS = 32
CRM_DOWNLOAD_CACHE: OrderedDict[str, tuple[bytes, str, str]] = OrderedDict()
QUOTE_PDF_STAMP_RESERVED_ROWS = 4
QUOTE_PDF_BASE_ROW_HEIGHT_MM = 9
QUOTE_PDF_STAMP_ROW_HEIGHT_MM = 11.0
QUOTE_PDF_STAMP_PADDING_MM = 0.75
QUOTE_PDF_MIN_BLANK_ROW_HEIGHT_MM = 5.5


def _normalize_limit_arg(raw_limit, *, default: int = 5, maximum: int = 200) -> int | None:
    if raw_limit is None:
        return default
    if isinstance(raw_limit, str) and raw_limit.strip().lower() in {"all", "全部"}:
        return None
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return default
    if limit < 1:
        return default
    return min(limit, maximum)


def _cache_datetime_token(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _build_download_cache_key(prefix: str, *parts: object) -> str:
    normalized = [str(prefix)]
    for part in parts:
        normalized.append(_cache_datetime_token(part))
    return "|".join(normalized)


def _line_items_cache_token(items) -> str:
    payload = [
        {
            "id": item.id,
            "sort_order": item.sort_order,
            "description": item.description,
            "unit": item.unit,
            "note": getattr(item, "note", None),
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "amount": item.amount,
        }
        for item in sorted(
            list(items or []),
            key=lambda item: (
                item.sort_order if item.sort_order is not None else 10**9,
                item.id if item.id is not None else 10**9,
            ),
        )
    ]
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _get_cached_download(cache_key: str) -> tuple[bytes, str, str] | None:
    cached = CRM_DOWNLOAD_CACHE.get(cache_key)
    if cached is None:
        return None
    CRM_DOWNLOAD_CACHE.move_to_end(cache_key)
    return cached


def _store_cached_download(cache_key: str, *, content: bytes, filename: str, mimetype: str) -> None:
    CRM_DOWNLOAD_CACHE[cache_key] = (content, filename, mimetype)
    CRM_DOWNLOAD_CACHE.move_to_end(cache_key)
    while len(CRM_DOWNLOAD_CACHE) > CRM_DOWNLOAD_CACHE_MAX_ITEMS:
        CRM_DOWNLOAD_CACHE.popitem(last=False)
FINANCIAL_DIGITS = ("零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖")
FINANCIAL_SMALL_UNITS = ("", "拾", "佰", "仟")
FINANCIAL_BIG_UNITS = ("", "萬", "億", "兆")


def _font_supports_traditional_chinese(font_name: str) -> bool:
    if font_name in PDF_CID_FALLBACKS:
        return True
    try:
        font = pdfmetrics.getFont(font_name)
    except Exception:
        return False

    face = getattr(font, "face", None)
    char_widths = getattr(face, "charWidths", None)
    if isinstance(char_widths, dict) and all(ord(ch) in char_widths for ch in PDF_CJK_PROBE):
        return True

    # Some reportlab/font combinations don't expose complete charWidths for TTC fonts.
    # Fallback to a render-width probe to avoid false negatives in container deployments.
    try:
        width = float(pdfmetrics.stringWidth(PDF_CJK_PROBE, font_name, 12))
        return width > 0
    except Exception:
        return False


def _env_flag(name: str, default: bool = False) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _candidate_pdf_font_paths() -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()

    def _add(path: str) -> None:
        normalized = (path or "").strip()
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        paths.append(normalized)

    configured = os.environ.get(PDF_FONT_ENV, "").strip()
    if configured and os.path.exists(configured):
        _add(configured)

    for candidate in PDF_FONT_CANDIDATES:
        if os.path.exists(candidate):
            _add(candidate)

    # Runtime fallback for distros where the package path differs.
    dynamic_patterns = (
        "/usr/local/share/fonts/**/*NotoSansTC*.ttf",
        "/usr/local/share/fonts/**/*NotoSerifTC*.ttf",
        "/usr/share/fonts/**/*NotoSansCJK*Regular*.ttc",
        "/usr/share/fonts/**/*NotoSerifCJK*Regular*.ttc",
        "/usr/share/fonts/**/*SourceHanSansTW*Regular*.otf",
        "/usr/share/fonts/**/*SourceHanSans*Regular*.otf",
    )
    for pattern in dynamic_patterns:
        for path in sorted(glob.glob(pattern, recursive=True)):
            if os.path.isfile(path):
                _add(path)

    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    windows_patterns = (
        "*NotoSansTC*.ttf",
        "*NotoSerifTC*.ttf",
        "msjh*.ttc",
        "mingliu*.ttc",
        "kaiu.ttf",
    )
    for pattern in windows_patterns:
        for path in sorted(windows_fonts.glob(pattern)):
            if path.is_file():
                _add(str(path))
    return paths


def _discover_pdf_font_path() -> str:
    return (_candidate_pdf_font_paths() or [""])[0]


def _ensure_pdf_font():
    global PDF_FONT_NAME, PDF_FONT_SOURCE, PDF_FONT_PATH_USED

    if PDF_FONT_NAME in ("CustomFont", *PDF_CID_FALLBACKS) and _font_supports_traditional_chinese(PDF_FONT_NAME):
        return

    for font_path in _candidate_pdf_font_paths():
        if not font_path or not os.path.exists(font_path):
            continue
        # Noto CJK on Debian is usually a .ttc. Try multiple subfont indexes.
        # Prefer TC/HK indices first, then SC/KR/JP.
        ttc_indices = (3, 4, 2, 1, 0) if font_path.lower().endswith(".ttc") else (0,)
        for idx in ttc_indices:
            try:
                pdfmetrics.registerFont(TTFont("CustomFont", font_path, subfontIndex=idx))
                if _font_supports_traditional_chinese("CustomFont"):
                    PDF_FONT_NAME = "CustomFont"
                    PDF_FONT_SOURCE = "filesystem"
                    PDF_FONT_PATH_USED = font_path
                    return
            except Exception:
                continue

    # Optional fallback: built-in CID fonts are not embedded and may render incorrectly
    # on some mobile/desktop PDF readers. Keep this disabled by default.
    if not _env_flag(PDF_REQUIRE_EMBEDDED_FONT_ENV, default=True):
        for cid_name in PDF_CID_FALLBACKS:
            try:
                pdfmetrics.registerFont(UnicodeCIDFont(cid_name))
                if _font_supports_traditional_chinese(cid_name):
                    PDF_FONT_NAME = cid_name
                    PDF_FONT_SOURCE = f"cid:{cid_name}"
                    PDF_FONT_PATH_USED = ""
                    return
            except Exception:
                continue

    PDF_FONT_NAME = "Helvetica"
    PDF_FONT_SOURCE = "default"
    PDF_FONT_PATH_USED = ""


def _require_embedded_pdf_font() -> None:
    _ensure_pdf_font()
    if PDF_FONT_SOURCE == "filesystem" and _font_supports_traditional_chinese(PDF_FONT_NAME):
        return
    raise RuntimeError(
        "PDF font is not embedded-capable for Traditional Chinese. "
        f"Current source={PDF_FONT_SOURCE!r}. Set {PDF_FONT_ENV} to a CJK font file "
        "(e.g. NotoSansCJK-Regular.ttc)."
    )


def _pdf_font_health_payload() -> dict:
    _ensure_pdf_font()
    require_embedded = _env_flag(PDF_REQUIRE_EMBEDDED_FONT_ENV, default=True)
    embedded_ok = PDF_FONT_SOURCE == "filesystem" and _font_supports_traditional_chinese(PDF_FONT_NAME)
    configured_font_path = (os.environ.get(PDF_FONT_ENV) or "").strip()
    return {
        "font_name": PDF_FONT_NAME,
        "font_source": PDF_FONT_SOURCE,
        "font_path": PDF_FONT_PATH_USED,
        "configured_font_path": configured_font_path or None,
        "configured_font_path_exists": bool(configured_font_path and os.path.exists(configured_font_path)),
        "discovered_font_path": _discover_pdf_font_path() or None,
        "font_candidates_found": _candidate_pdf_font_paths(),
        "supports_traditional_chinese": _font_supports_traditional_chinese(PDF_FONT_NAME),
        "require_embedded_font": require_embedded,
        "embedded_font_ready": embedded_ok,
        "pdf_generation_ready": embedded_ok or not require_embedded,
        "probe_text": PDF_CJK_PROBE,
        "candidates": list(PDF_FONT_CANDIDATES),
        "hint": f"Set {PDF_FONT_ENV} to a Noto/SourceHan CJK font file path if PDF is not ready.",
    }


def _resolve_pdf_stamp_path() -> str | None:
    configured = (os.environ.get(PDF_STAMP_ENV) or "").strip()
    if configured and os.path.exists(configured):
        return configured

    backend_dir = Path(__file__).resolve().parents[1]
    default_path = backend_dir.parent / "data" / PDF_STAMP_DEFAULT_FILENAME
    if default_path.exists() and default_path.is_file():
        return str(default_path)
    return None


def _resolve_pdf_stamp_rotation_deg() -> float:
    raw = (os.environ.get(PDF_STAMP_ROTATE_ENV) or "").strip()
    if not raw:
        return PDF_STAMP_DEFAULT_ROTATE_DEG
    try:
        return float(raw)
    except ValueError:
        return PDF_STAMP_DEFAULT_ROTATE_DEG


def _resolve_pdf_stamp_y_offset_mm() -> float:
    raw = (os.environ.get(PDF_STAMP_Y_OFFSET_ENV) or "").strip()
    if not raw:
        return PDF_STAMP_DEFAULT_Y_OFFSET_MM
    try:
        value = float(raw)
        return max(-20.0, min(20.0, value))
    except ValueError:
        return PDF_STAMP_DEFAULT_Y_OFFSET_MM


def _flowable_render_height(flowable, avail_width: float, avail_height: float) -> float:
    width = max(avail_width, 1.0)
    height = max(avail_height, 1.0)
    _, wrapped_h = flowable.wrap(width, height)
    before = float(flowable.getSpaceBefore()) if hasattr(flowable, "getSpaceBefore") else 0.0
    after = float(flowable.getSpaceAfter()) if hasattr(flowable, "getSpaceAfter") else 0.0
    return float(wrapped_h) + before + after


def _rotated_rect_half_extents(width: float, height: float, rotate_deg: float) -> tuple[float, float]:
    radians = math.radians(float(rotate_deg or 0.0))
    cos_v = abs(math.cos(radians))
    sin_v = abs(math.sin(radians))
    half_w = (float(width) * cos_v + float(height) * sin_v) / 2.0
    half_h = (float(width) * sin_v + float(height) * cos_v) / 2.0
    return half_w, half_h


def _quote_pdf_item_row_count(
    item_count: int,
    rows_per_page: int,
    *,
    reserved_blank_rows: int = QUOTE_PDF_STAMP_RESERVED_ROWS,
    trailing_stamp_safe_rows: int = 0,
) -> int:
    rows_per_page = max(int(rows_per_page or 1), 1)
    item_count = max(int(item_count or 0), 0)
    reserved_blank_rows = max(int(reserved_blank_rows or 0), 0)
    trailing_stamp_safe_rows = max(int(trailing_stamp_safe_rows or 0), 0)
    page_count = max(1, math.ceil(max(item_count, 1) / rows_per_page))
    row_count = page_count * rows_per_page
    if item_count <= 0 or reserved_blank_rows <= 0:
        return row_count

    last_page_item_count = item_count % rows_per_page or rows_per_page
    usable_stamp_rows = (
        rows_per_page
        - last_page_item_count
        + min(trailing_stamp_safe_rows, last_page_item_count)
    )
    if usable_stamp_rows < reserved_blank_rows:
        row_count += rows_per_page
    return row_count


def _quote_pdf_trailing_stamp_safe_rows(items: list[object]) -> int:
    safe_rows = 0
    for item in reversed(items):
        if isinstance(item, dict):
            unit_price = item.get("unit_price")
            amount = item.get("amount")
            note = item.get("note")
        else:
            unit_price = getattr(item, "unit_price", None)
            amount = getattr(item, "amount", None)
            note = getattr(item, "note", None)
        try:
            has_value = abs(float(unit_price or 0)) > 0.0001 or abs(float(amount or 0)) > 0.0001
        except (TypeError, ValueError):
            has_value = True
        if has_value or str(note or "").strip():
            break
        safe_rows += 1
    return safe_rows


def _quote_pdf_stamp_row_range(
    item_count: int,
    item_row_count: int,
    rows_per_page: int,
    *,
    reserved_rows: int = QUOTE_PDF_STAMP_RESERVED_ROWS,
    trailing_stamp_safe_rows: int = 0,
) -> tuple[int, int]:
    item_count = max(int(item_count or 0), 0)
    item_row_count = max(int(item_row_count or 0), 0)
    rows_per_page = max(int(rows_per_page or 1), 1)
    reserved_rows = max(int(reserved_rows or 0), 0)
    trailing_stamp_safe_rows = max(int(trailing_stamp_safe_rows or 0), 0)
    if item_row_count <= 0 or reserved_rows <= 0:
        return 0, -1

    last_page_start = ((item_row_count - 1) // rows_per_page) * rows_per_page
    last_page_end = min(item_row_count, last_page_start + rows_per_page)
    blank_rows = max(0, last_page_end - max(item_count, last_page_start))
    rows_needed_from_items = max(0, reserved_rows - blank_rows)
    usable_trailing_rows = min(
        trailing_stamp_safe_rows,
        rows_needed_from_items,
        max(0, item_count - last_page_start),
    )
    first_slot = max(last_page_start, item_count - usable_trailing_rows)
    last_slot = min(item_row_count, first_slot + reserved_rows) - 1
    return first_slot, last_slot


def _fit_stamp_in_safe_box(
    stamp_w: float,
    stamp_h: float,
    rotate_deg: float,
    safe_box: dict[str, float],
    *,
    padding: float = 1.5 * mm,
) -> tuple[float, float, float, float] | None:
    left_x = float(safe_box.get("left_x", safe_box.get("col_left_x", 0.0)))
    right_x = float(safe_box.get("right_x", safe_box.get("col_right_x", 0.0)))
    bottom_y = float(safe_box.get("bottom_y", safe_box.get("row_bottom_y", 0.0)))
    top_y = float(safe_box.get("top_y", safe_box.get("row_top_y", 0.0)))
    available_w = max(0.0, right_x - left_x - (2.0 * padding))
    available_h = max(0.0, top_y - bottom_y - (2.0 * padding))
    if available_w <= 0.0 or available_h <= 0.0:
        return None

    bbox_half_w, bbox_half_h = _rotated_rect_half_extents(stamp_w, stamp_h, rotate_deg)
    if bbox_half_w <= 0.0 or bbox_half_h <= 0.0:
        return None

    if available_w < (2.0 * bbox_half_w) or available_h < (2.0 * bbox_half_h):
        return None

    fitted_w = float(stamp_w)
    fitted_h = float(stamp_h)
    return (left_x + right_x) / 2.0, (bottom_y + top_y) / 2.0, fitted_w, fitted_h


def _quote_pdf_row_heights(
    item_count: int,
    item_row_count: int,
    rows_per_page: int,
    *,
    reserved_blank_rows: int = QUOTE_PDF_STAMP_RESERVED_ROWS,
    trailing_stamp_safe_rows: int = 0,
    item_heights: list[float] | None = None,
) -> list[float]:
    row_heights = [QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm] * (int(item_row_count) + 2)
    item_count = max(int(item_count or 0), 0)
    item_row_count = max(int(item_row_count or 0), 0)
    rows_per_page = max(int(rows_per_page or 1), 1)
    reserved_blank_rows = max(int(reserved_blank_rows or 0), 0)
    for item_slot, height in enumerate((item_heights or [])[: min(item_count, item_row_count)]):
        row_heights[item_slot + 1] = max(row_heights[item_slot + 1], float(height or 0))
    if not row_heights or item_row_count <= 0 or reserved_blank_rows <= 0:
        return row_heights

    first_reserved_slot, last_reserved_slot = _quote_pdf_stamp_row_range(
        item_count,
        item_row_count,
        rows_per_page,
        reserved_rows=reserved_blank_rows,
        trailing_stamp_safe_rows=trailing_stamp_safe_rows,
    )
    for item_slot in range(first_reserved_slot, last_reserved_slot + 1):
        row_heights[item_slot + 1] = QUOTE_PDF_STAMP_ROW_HEIGHT_MM * mm

    dynamic_extra = sum(
        max(0.0, row_heights[item_slot + 1] - (QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm))
        for item_slot in range(min(item_count, item_row_count))
    )
    reserved_slots = set(range(first_reserved_slot, last_reserved_slot + 1))
    flexible_blank_slots = [
        item_slot
        for item_slot in range(item_count, item_row_count)
        if item_slot not in reserved_slots
    ]
    if dynamic_extra > 0 and flexible_blank_slots:
        max_reduction = (QUOTE_PDF_BASE_ROW_HEIGHT_MM - QUOTE_PDF_MIN_BLANK_ROW_HEIGHT_MM) * mm
        reduction_per_row = min(max_reduction, dynamic_extra / len(flexible_blank_slots))
        for item_slot in flexible_blank_slots:
            row_heights[item_slot + 1] -= reduction_per_row
    return row_heights


def _quote_pdf_item_heights(rows: list[list[object]], col_widths: list[float], item_count: int) -> list[float]:
    item_heights: list[float] = []
    horizontal_padding = 12.0
    vertical_padding = 8.0
    for row_index in range(1, min(item_count, len(rows) - 1) + 1):
        required_height = QUOTE_PDF_BASE_ROW_HEIGHT_MM * mm
        for col_index in (1, 2, 7):
            value = rows[row_index][col_index]
            if not hasattr(value, "wrap"):
                continue
            available_width = max(1.0, float(col_widths[col_index]) - horizontal_padding)
            _, content_height = value.wrap(available_width, A4[1])
            required_height = max(required_height, float(content_height) + vertical_padding)
        item_heights.append(required_height)
    return item_heights


def _table_cell_text(value: object) -> str:
    if hasattr(value, "getPlainText"):
        return str(value.getPlainText())
    return str(value or "")


def _xlsx_safe_text(value: object) -> str:
    text_value = str(value or "")
    if text_value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text_value
    return text_value


def _table_page_fragments(doc, flowables_before, table) -> list[dict[str, object]]:
    used_height = 0.0
    remaining_height = float(doc.height)
    for flowable in flowables_before:
        block_h = _flowable_render_height(flowable, float(doc.width), remaining_height)
        used_height += block_h
        remaining_height = max(1.0, remaining_height - block_h)

    page_w, page_h = doc.pagesize
    del page_w
    pending = table
    page_index = 1
    first_page = True
    fragments: list[dict[str, object]] = []
    for _ in range(100):
        available_height = max(1.0, float(doc.height) - used_height) if first_page else float(doc.height)
        table_top = (
            float(page_h) - float(doc.topMargin) - used_height
            if first_page
            else float(page_h) - float(doc.topMargin)
        )
        parts = pending.split(float(doc.width), available_height)
        if not parts:
            if first_page and used_height > 0:
                first_page = False
                page_index += 1
                continue
            return []

        fragment = parts[0]
        fragment.wrap(float(doc.width), available_height)
        fragments.append(
            {
                "page_index": page_index,
                "table_top": table_top,
                "table": fragment,
            }
        )
        if len(parts) == 1:
            return fragments
        pending = parts[1]
        first_page = False
        page_index += 1
    return []


def _find_table_label_range_box(
    doc,
    flowables_before,
    table,
    *,
    first_label: str,
    last_label: str,
    first_col: int,
    last_col: int,
) -> dict[str, float] | None:
    for layout in _table_page_fragments(doc, flowables_before, table):
        fragment = layout["table"]
        row_heights = [float(v) for v in getattr(fragment, "_rowHeights", [])]
        col_widths = [float(v) for v in getattr(fragment, "_colWidths", [])]
        cell_values = list(getattr(fragment, "_cellvalues", []))
        labels = [_table_cell_text(row[0]) if row else "" for row in cell_values]
        try:
            first_row = labels.index(first_label)
            last_row = labels.index(last_label)
        except ValueError:
            continue
        if last_row < first_row or not row_heights or not col_widths:
            continue

        table_w = sum(col_widths)
        table_left = float(doc.leftMargin) + (float(doc.width) - table_w) / 2.0
        table_top = float(layout["table_top"])
        return {
            "left_x": table_left + sum(col_widths[:first_col]),
            "right_x": table_left + sum(col_widths[: last_col + 1]),
            "top_y": table_top - sum(row_heights[:first_row]),
            "bottom_y": table_top - sum(row_heights[: last_row + 1]),
            "target_page": float(layout["page_index"]),
        }
    return None


def _estimate_table_cell_box(doc, flowables_before, table, row_index: int, col_index: int, h_align: str):
    try:
        table.wrap(doc.width, doc.height)
        row_heights = [float(v) for v in getattr(table, "_rowHeights", [])]
        col_widths = [float(v) for v in getattr(table, "_colWidths", [])]
        if not row_heights or not col_widths:
            return None
        if row_index < 0 or row_index >= len(row_heights):
            return None
        if col_index < 0 or col_index >= len(col_widths):
            return None

        used_height = 0.0
        remaining_height = float(doc.height)
        for flowable in flowables_before:
            block_h = _flowable_render_height(flowable, float(doc.width), remaining_height)
            used_height += block_h
            remaining_height = max(1.0, remaining_height - block_h)

        page_w, page_h = doc.pagesize
        table_w = sum(col_widths)
        align = (h_align or "LEFT").upper()
        if align == "RIGHT":
            table_left = float(doc.leftMargin) + float(doc.width) - table_w
        elif align == "CENTER":
            table_left = float(doc.leftMargin) + (float(doc.width) - table_w) / 2.0
        else:
            table_left = float(doc.leftMargin)

        table_top = float(page_h) - float(doc.topMargin) - used_height
        row_top = table_top - sum(row_heights[:row_index])
        row_bottom = row_top - row_heights[row_index]
        row_center_y = row_top - row_heights[row_index] / 2.0
        col_left = table_left + sum(col_widths[:col_index])
        col_right = col_left + col_widths[col_index]
        col_center_x = col_left + col_widths[col_index] / 2.0
        return {
            "col_left_x": float(col_left),
            "col_right_x": float(col_right),
            "col_center_x": float(col_center_x),
            "row_top_y": float(row_top),
            "row_bottom_y": float(row_bottom),
            "row_center_y": float(row_center_y),
            "row_height": float(row_heights[row_index]),
            "col_width": float(col_widths[col_index]),
        }
    except Exception:
        return None


def _estimate_table_cell_center(doc, flowables_before, table, row_index: int, col_index: int, h_align: str):
    box = _estimate_table_cell_box(doc, flowables_before, table, row_index=row_index, col_index=col_index, h_align=h_align)
    if not box:
        return None
    return box["col_center_x"], box["row_center_y"]


def _draw_pdf_stamp(canvas, doc, placement=None):
    if isinstance(placement, dict) and placement.get("disabled"):
        return
    stamp_path = _resolve_pdf_stamp_path()
    if not stamp_path:
        return
    try:
        image = ImageReader(stamp_path)
        src_w, src_h = image.getSize()
        if not src_w or not src_h:
            return

        stamp_w = PDF_STAMP_WIDTH_MM * mm
        stamp_h = stamp_w * float(src_h) / float(src_w)
        rotate_deg = _resolve_pdf_stamp_rotation_deg()
        y_offset = _resolve_pdf_stamp_y_offset_mm() * mm
        bbox_half_w, bbox_half_h = _rotated_rect_half_extents(stamp_w, stamp_h, rotate_deg)

        apply_y_offset = True
        if placement is not None:
            if isinstance(placement, dict):
                center_x = placement["center_x"]
                center_y = placement["center_y"]
                stamp_w = placement.get("stamp_w", stamp_w)
                stamp_h = placement.get("stamp_h", stamp_h)
                apply_y_offset = bool(placement.get("apply_y_offset", False))
            elif len(placement) == 4:
                center_x, center_y, stamp_w, stamp_h = placement
                apply_y_offset = False
            else:
                center_x, center_y = placement
            bbox_half_w, bbox_half_h = _rotated_rect_half_extents(stamp_w, stamp_h, rotate_deg)
        else:
            page_w, page_h = doc.pagesize
            center_x = page_w - doc.rightMargin - bbox_half_w
            center_y = page_h - doc.topMargin - bbox_half_h + 4 * mm
        if apply_y_offset:
            center_y += y_offset
        page_w, page_h = doc.pagesize
        min_x = float(doc.leftMargin) + bbox_half_w
        max_x = float(page_w) - float(doc.rightMargin) - bbox_half_w
        min_y = float(doc.bottomMargin) + bbox_half_h
        max_y = float(page_h) - float(doc.topMargin) - bbox_half_h
        center_x = max(min_x, min(max_x, float(center_x)))
        center_y = max(min_y, min(max_y, float(center_y)))

        canvas.saveState()
        canvas.translate(center_x, center_y)
        canvas.rotate(rotate_deg)
        canvas.drawImage(
            image,
            -stamp_w / 2.0,
            -stamp_h / 2.0,
            width=stamp_w,
            height=stamp_h,
            preserveAspectRatio=True,
            mask="auto",
        )
        canvas.restoreState()
    except Exception:
        return


def _make_pdf_stamp_canvasmaker(doc, placement=None):
    class _StampCanvas(pdf_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total_pages = len(self._saved_page_states)
            for page_index, page_state in enumerate(self._saved_page_states, start=1):
                self.__dict__.update(page_state)
                target_page = None
                if isinstance(placement, dict):
                    target_page = placement.get("target_page")
                should_draw = page_index == total_pages if target_page is None else page_index == int(target_page)
                if should_draw:
                    _draw_pdf_stamp(self, doc, placement)
                super().showPage()
            super().save()

    return _StampCanvas


def _parse_date(raw, field_name: str):
    if raw in (None, ""):
        return None, None
    if isinstance(raw, date):
        return raw, None
    try:
        return date.fromisoformat(str(raw)), None
    except ValueError:
        return None, (jsonify({"msg": f"Invalid {field_name} format, expected YYYY-MM-DD"}), 400)


def _parse_float(raw, field_name: str, *, minimum: float | None = None):
    if raw in (None, ""):
        return None, None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, (jsonify({"msg": f"{field_name} must be a number"}), 400)
    if minimum is not None and value < minimum:
        return None, (jsonify({"msg": f"{field_name} must be >= {minimum}"}), 400)
    return value, None


def _normalize_items(raw_items):
    if not isinstance(raw_items, list) or not raw_items:
        return None, (jsonify({"msg": "items is required and must be a non-empty array"}), 400)

    normalized = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            return None, (jsonify({"msg": f"items[{idx}] must be an object"}), 400)

        description = (raw.get("description") or "").strip()
        if not description:
            return None, (jsonify({"msg": f"items[{idx}].description is required"}), 400)
        note = (raw.get("note") or "").strip() or None
        unit = (raw.get("unit") or "").strip() or "式"

        qty, qty_err = _parse_float(raw.get("quantity", 1), f"items[{idx}].quantity", minimum=0)
        if qty_err:
            return None, qty_err
        unit_price_val, price_err = _parse_float(raw.get("unit_price", 0), f"items[{idx}].unit_price", minimum=0)
        if price_err:
            return None, price_err

        quantity = qty if qty is not None else 1.0
        unit_price = unit_price_val if unit_price_val is not None else 0.0
        amount = round(quantity * unit_price, 2)
        normalized.append(
            {
                "description": description,
                "unit": unit,
                "note": note,
                "quantity": quantity,
                "unit_price": unit_price,
                "amount": amount,
                "sort_order": idx,
            }
        )

    return normalized, None


def _sync_quote_items_to_catalog(items: list[dict]) -> None:
    ignored_names = {"以下空白", "稅金"}
    seen_names: set[str] = set()

    for item in items or []:
        name = str(item.get("description") or "").strip()
        if not name or name in ignored_names:
            continue

        normalized_name = name.casefold()
        if normalized_name in seen_names:
            continue
        seen_names.add(normalized_name)

        existing = ServiceCatalogItem.query.filter(func.lower(ServiceCatalogItem.name) == normalized_name).first()
        if existing is None:
            db.session.add(
                ServiceCatalogItem(
                    name=name,
                    unit=(item.get("unit") or "").strip() or "式",
                    unit_price=round(float(item.get("unit_price") or 0.0), 2),
                    is_active=True,
                )
            )
            continue

        if not existing.is_active:
            existing.is_active = True
        if not (existing.unit or "").strip():
            existing.unit = (item.get("unit") or "").strip() or "式"
        if float(existing.unit_price or 0.0) <= 0 and float(item.get("unit_price") or 0.0) > 0:
            existing.unit_price = round(float(item.get("unit_price") or 0.0), 2)


def _apply_totals(entity, items: list[dict], tax_rate_raw):
    subtotal = round(sum(item["amount"] for item in items), 2)
    tax_rate, tax_rate_err = _parse_float(tax_rate_raw, "tax_rate", minimum=0)
    if tax_rate_err:
        return tax_rate_err

    safe_tax_rate = round(tax_rate or 0.0, 2)
    raw_tax_amount = subtotal * safe_tax_rate / 100.0
    tax_amount = float(math.ceil(raw_tax_amount)) if raw_tax_amount > 0 else 0.0
    total_amount = round(subtotal + tax_amount, 2)

    entity.subtotal = subtotal
    entity.tax_rate = safe_tax_rate
    entity.tax_amount = tax_amount
    entity.total_amount = total_amount
    return None


def _next_quote_no(reference_date: date | None = None) -> str:
    ymd = reference_date.strftime("%Y%m%d") if reference_date else datetime.utcnow().strftime("%Y%m%d")
    prefix = f"QT-{ymd}-"

    rows = Quote.query.with_entities(Quote.quote_no).filter(Quote.quote_no.like(f"{prefix}%")).all()
    max_seq = 0
    for (quote_no,) in rows:
        if not isinstance(quote_no, str) or not quote_no.startswith(prefix):
            continue
        suffix = quote_no[len(prefix):]
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))

    next_seq = max_seq + 1
    candidate = f"{prefix}{next_seq:03d}"
    while Quote.query.filter(Quote.quote_no == candidate).first() is not None:
        next_seq += 1
        candidate = f"{prefix}{next_seq:03d}"
    return candidate


def _duplicate_quote(source: Quote, *, today: date | None = None) -> Quote:
    issue_date = today or date.today()
    if source.issue_date and source.expiry_date:
        valid_days = max(0, (source.expiry_date - source.issue_date).days)
    else:
        valid_days = DEFAULT_QUOTE_VALID_DAYS
    expiry_date = issue_date + timedelta(days=valid_days)
    items = [
        {
            "description": item.description,
            "unit": item.unit,
            "note": item.note,
            "quantity": float(item.quantity or 0.0),
            "unit_price": float(item.unit_price or 0.0),
            "amount": round(float(item.quantity or 0.0) * float(item.unit_price or 0.0), 2),
            "sort_order": index,
        }
        for index, item in enumerate(
            sorted(
                source.items or [],
                key=lambda row: (
                    row.sort_order if row.sort_order is not None else 10**9,
                    row.id if row.id is not None else 10**9,
                ),
            )
        )
    ]

    quote = Quote(
        quote_no=_next_quote_no(issue_date),
        status="draft",
        customer_id=source.customer_id,
        contact_id=source.contact_id,
        recipient_name=source.recipient_name,
        site_address=source.site_address,
        issue_date=issue_date,
        expiry_date=expiry_date,
        currency=(source.currency or "TWD").strip().upper() or "TWD",
        note=source.note,
        created_by_id=get_current_user_id(),
    )
    total_err = _apply_totals(quote, items, source.tax_rate)
    if total_err:
        raise ValueError("Invalid source quote totals")

    db.session.add(quote)
    db.session.flush()
    for item in items:
        db.session.add(QuoteItem(quote_id=quote.id, **item))
    _sync_quote_items_to_catalog(items)

    db.session.flush()
    copied = Quote.query.options(selectinload(Quote.items)).get(quote.id) or quote
    _append_quote_version_snapshot(
        copied,
        action="duplicate",
        summary=f"Duplicated from {source.quote_no}",
    )
    if source.customer:
        db.session.add(_create_task_for_quote(copied, source.customer, source.contact))
    return copied


def _next_invoice_no() -> str:
    ymd = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"INV-{ymd}-"

    rows = Invoice.query.with_entities(Invoice.invoice_no).filter(Invoice.invoice_no.like(f"{prefix}%")).all()
    max_seq = 0
    for (invoice_no,) in rows:
        if not isinstance(invoice_no, str) or not invoice_no.startswith(prefix):
            continue
        suffix = invoice_no[len(prefix):]
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))

    next_seq = max_seq + 1
    candidate = f"{prefix}{next_seq:03d}"
    while Invoice.query.filter(Invoice.invoice_no == candidate).first() is not None:
        next_seq += 1
        candidate = f"{prefix}{next_seq:03d}"
    return candidate


def _next_quote_version_no(quote_id: int) -> int:
    latest = (
        QuoteVersion.query.with_entities(QuoteVersion.version_no)
        .filter(QuoteVersion.quote_id == quote_id)
        .order_by(QuoteVersion.version_no.desc())
        .first()
    )
    return int(latest[0]) + 1 if latest else 1


def _append_quote_version_snapshot(quote: Quote, *, action: str, summary: str | None = None) -> None:
    quote_payload = quote.to_dict()
    db.session.add(
        QuoteVersion(
            quote_id=quote.id,
            version_no=_next_quote_version_no(quote.id),
            action=(action or "update").strip().lower() or "update",
            summary=(summary or "").strip() or None,
            snapshot_json=json.dumps(quote_payload, ensure_ascii=False),
            changed_by_id=get_current_user_id(),
        )
    )


def _contract_pdf_font_name() -> str:
    """Return an embedded Traditional Chinese serif font for formal contracts."""
    _require_embedded_pdf_font()
    if _font_supports_traditional_chinese(CONTRACT_PDF_FONT_NAME):
        return CONTRACT_PDF_FONT_NAME

    configured = (os.environ.get(CONTRACT_PDF_FONT_ENV) or "").strip()
    candidates = [configured, *CONTRACT_PDF_FONT_CANDIDATES]
    for font_path in candidates:
        if not font_path or not os.path.exists(font_path):
            continue
        ttc_indices = (3, 4, 2, 1, 0) if font_path.lower().endswith(".ttc") else (0,)
        for idx in ttc_indices:
            try:
                pdfmetrics.registerFont(TTFont(CONTRACT_PDF_FONT_NAME, font_path, subfontIndex=idx))
                if _font_supports_traditional_chinese(CONTRACT_PDF_FONT_NAME):
                    return CONTRACT_PDF_FONT_NAME
            except Exception:
                continue
    return PDF_FONT_NAME


def _next_contract_no(reference_date: date | None = None) -> str:
    contract_date = reference_date or date.today()
    prefix = f"CT-{contract_date.strftime('%Y%m%d')}-"
    rows = Contract.query.with_entities(Contract.contract_no).filter(
        Contract.contract_no.like(f"{prefix}%")
    ).all()
    max_seq = 0
    for (contract_no,) in rows:
        suffix = contract_no[len(prefix):] if isinstance(contract_no, str) and contract_no.startswith(prefix) else ""
        if suffix.isdigit():
            max_seq = max(max_seq, int(suffix))
    return f"{prefix}{max_seq + 1:03d}"


def _latest_quote_version_no(quote: Quote) -> int:
    latest = (
        QuoteVersion.query.with_entities(QuoteVersion.version_no)
        .filter(QuoteVersion.quote_id == quote.id)
        .order_by(QuoteVersion.version_no.desc())
        .first()
    )
    if latest:
        return int(latest[0])
    _append_quote_version_snapshot(
        quote,
        action="contract_snapshot",
        summary="Snapshot created before contract",
    )
    db.session.flush()
    return _next_quote_version_no(quote.id) - 1


def _contract_quote_snapshot(quote: Quote, customer: Customer | None, contact: Contact | None) -> str:
    return json.dumps(
        {
            "quote": quote.to_dict(),
            "customer": customer.to_dict() if customer else None,
            "contact": contact.to_dict() if contact else None,
        },
        ensure_ascii=False,
    )


def _next_contract_version_no(contract_id: int) -> int:
    latest = (
        ContractVersion.query.with_entities(ContractVersion.version_no)
        .filter(ContractVersion.contract_id == contract_id)
        .order_by(ContractVersion.version_no.desc())
        .first()
    )
    return int(latest[0]) + 1 if latest else 1


def _contract_version_snapshot(contract: Contract) -> str:
    payload = contract.to_dict()
    try:
        payload["quote_snapshot"] = json.loads(contract.quote_snapshot_json)
    except (TypeError, json.JSONDecodeError):
        payload["quote_snapshot"] = None
    return json.dumps(payload, ensure_ascii=False)


def _append_contract_version(
    contract: Contract,
    *,
    action: str,
    summary: str | None = None,
) -> None:
    db.session.add(
        ContractVersion(
            contract_id=contract.id,
            version_no=_next_contract_version_no(contract.id),
            action=(action or "update").strip().lower() or "update",
            summary=(summary or "").strip()[:255] or None,
            snapshot_json=_contract_version_snapshot(contract),
            changed_by_id=get_current_user_id(),
        )
    )


def _contract_text(value, *, maximum: int, required: bool = False) -> tuple[str | None, tuple | None]:
    text_value = str(value or "").strip()
    if required and not text_value:
        return None, (jsonify({"msg": "Required contract field is missing"}), 400)
    if len(text_value) > maximum:
        return None, (jsonify({"msg": f"Contract field must be at most {maximum} characters"}), 400)
    return text_value or None, None


def _apply_contract_payload(contract: Contract, data: dict) -> tuple | None:
    text_fields = {
        "project_name": (255, True),
        "site_address": (500, False),
        "party_a_name": (255, True),
        "party_a_tax_id": (64, False),
        "party_a_phone": (64, False),
        "party_a_address": (1000, False),
        "party_b_name": (255, True),
        "party_b_tax_id": (64, False),
        "party_b_phone": (64, False),
        "party_b_address": (1000, False),
        "payment_terms": (2000, True),
        "special_terms": (4000, False),
    }
    for field, (maximum, required) in text_fields.items():
        if field not in data:
            continue
        value, error = _contract_text(data.get(field), maximum=maximum, required=required)
        if error:
            return error
        setattr(contract, field, value)

    for field in ("contract_date", "start_date", "end_date"):
        if field not in data:
            continue
        parsed, error = _parse_date(data.get(field), field)
        if error:
            return error
        if field == "contract_date" and parsed is None:
            return jsonify({"msg": "contract_date is required"}), 400
        setattr(contract, field, parsed)

    if "status" in data:
        status = str(data.get("status") or "").strip().lower()
        if status not in VALID_CONTRACT_STATUS:
            return jsonify({"msg": "Invalid contract status"}), 400
        contract.status = status

    if "warranty_months" in data:
        try:
            warranty_months = int(data.get("warranty_months"))
        except (TypeError, ValueError):
            return jsonify({"msg": "warranty_months must be an integer"}), 400
        if warranty_months < 0 or warranty_months > 120:
            return jsonify({"msg": "warranty_months must be between 0 and 120"}), 400
        contract.warranty_months = warranty_months

    if contract.start_date and contract.end_date and contract.end_date < contract.start_date:
        return jsonify({"msg": "end_date cannot be earlier than start_date"}), 400
    return None


def _invoice_module_disabled():
    return jsonify({"msg": "Invoice module is disabled in quote-only mode"}), 410


def _quote_display_total_without_tax(quote: Quote) -> float:
    # Show tax-inclusive amount so tax rate changes are reflected in quote totals.
    if quote.total_amount is not None:
        return float(quote.total_amount)
    return float(quote.subtotal or 0)


def _invoice_display_total_without_tax(invoice: Invoice) -> float:
    # Keep invoice PDF aligned with quote output: tax-exclusive amount.
    if invoice.subtotal is not None:
        return float(invoice.subtotal)
    return float(invoice.total_amount or 0)


def _invoice_payment_total(invoice: Invoice) -> float:
    return round(sum(float(row.amount or 0.0) for row in (invoice.payment_records or [])), 2)


def _active_invoice_for_quote(quote_id: int) -> Invoice | None:
    return (
        Invoice.query.filter(Invoice.quote_id == quote_id)
        .filter(Invoice.status != "cancelled")
        .order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .first()
    )


def _recalculate_invoice_payment_status(invoice: Invoice) -> None:
    if (invoice.status or "").strip().lower() == "cancelled":
        return

    total_amount = float(invoice.total_amount or 0.0)
    paid_total = float(_invoice_payment_total(invoice))
    epsilon = 1e-6

    if paid_total <= epsilon:
        if (invoice.status or "").strip().lower() in {"paid", "partially_paid"}:
            invoice.status = "issued"
        invoice.paid_at = None
        return

    if total_amount <= epsilon or paid_total + epsilon >= total_amount:
        invoice.status = "paid"
        latest_payment_date = None
        for row in (invoice.payment_records or []):
            if row.payment_date and (latest_payment_date is None or row.payment_date > latest_payment_date):
                latest_payment_date = row.payment_date
        invoice.paid_at = (
            datetime.combine(latest_payment_date, time.min)
            if latest_payment_date is not None
            else datetime.utcnow()
        )
        return

    invoice.status = "partially_paid"
    invoice.paid_at = None


def _invoice_payment_payload(invoice: Invoice) -> dict:
    return {
        "invoice": invoice.to_dict(),
        "payment_total": _invoice_payment_total(invoice),
    }


def _invoice_signature_image_path(invoice: Invoice) -> str | None:
    signature_path = (invoice.customer_signature_path or "").strip()
    if not signature_path:
        return None
    storage = current_app.extensions.get("storage")
    if not storage:
        return None
    try:
        local_path = storage.local_path(signature_path)
    except Exception:
        return None
    return str(local_path)


def _invoice_query_with_details():
    return Invoice.query.options(
        selectinload(Invoice.items),
        selectinload(Invoice.customer),
        selectinload(Invoice.contact),
        selectinload(Invoice.quote),
        selectinload(Invoice.payment_records).selectinload(InvoicePaymentRecord.received_by),
    )


def _audit_jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _audit_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_audit_jsonable(v) for v in value]
    if isinstance(value, float):
        return round(value, 4)
    return value


def _audit_field_changes(before: dict | None, after: dict | None, *, fields: list[str] | None = None) -> dict:
    before_map = before or {}
    after_map = after or {}
    keys = fields or sorted(set(before_map.keys()) | set(after_map.keys()))
    changes = {}
    for key in keys:
        before_value = _audit_jsonable(before_map.get(key))
        after_value = _audit_jsonable(after_map.get(key))
        if before_value != after_value:
            changes[key] = {"from": before_value, "to": after_value}
    return changes


def _append_audit_log(
    *,
    action: str,
    entity_type: str,
    entity_id=None,
    entity_label: str | None = None,
    details: dict | None = None,
    note: str | None = None,
    module: str = "crm",
) -> None:
    db.session.add(
        AuditLog(
            module=module,
            action=(action or "").strip() or "unknown",
            entity_type=(entity_type or "").strip() or "unknown",
            entity_id=str(entity_id) if entity_id not in (None, "") else None,
            entity_label=(entity_label or "").strip() or None,
            details_json=json.dumps(_audit_jsonable(details or {}), ensure_ascii=False) if details else None,
            note=(note or "").strip() or None,
            actor_id=get_current_user_id(),
        )
    )


def _to_roc_date_text(value: date | None) -> str:
    value = value or date.today()
    roc_year = value.year - 1911
    return f"中華民國  {roc_year} 年 {value.month} 月 {value.day} 日"


def _to_month_day_text(value: date | None) -> str:
    value = value or date.today()
    return f"{value.month} 月 {value.day} 日"


def _format_amount_number(amount: float) -> str:
    safe_amount = round(float(amount or 0), 2)
    if safe_amount.is_integer():
        return f"{safe_amount:,.0f}"
    return f"{safe_amount:,.2f}"


def _format_compact_table_number(value: float) -> str:
    safe_value = round(float(value or 0), 2)
    if safe_value.is_integer():
        return f"{safe_value:,.0f}"
    return f"{safe_value:,.2f}".rstrip("0").rstrip(".")


def _financial_group_to_text(group_value: int) -> str:
    if group_value <= 0:
        return ""
    text = ""
    zero_pending = False
    for unit_idx in range(3, -1, -1):
        base = 10**unit_idx
        digit = (group_value // base) % 10
        if digit == 0:
            if text:
                zero_pending = True
            continue
        if zero_pending:
            text += FINANCIAL_DIGITS[0]
            zero_pending = False
        text += FINANCIAL_DIGITS[digit] + FINANCIAL_SMALL_UNITS[unit_idx]
    return text


def _financial_integer_to_text(value: int) -> str:
    if value <= 0:
        return FINANCIAL_DIGITS[0]

    groups: list[int] = []
    while value > 0:
        groups.append(value % 10000)
        value //= 10000

    result: list[str] = []
    zero_between_groups = False
    for idx in range(len(groups) - 1, -1, -1):
        group_value = groups[idx]
        if group_value == 0:
            zero_between_groups = True
            continue
        if result and (zero_between_groups or group_value < 1000):
            result.append(FINANCIAL_DIGITS[0])
        zero_between_groups = False
        result.append(_financial_group_to_text(group_value))
        big_unit = FINANCIAL_BIG_UNITS[idx] if idx < len(FINANCIAL_BIG_UNITS) else ""
        if big_unit:
            result.append(big_unit)

    return "".join(result) if result else FINANCIAL_DIGITS[0]


def _format_financial_amount_text(amount: float) -> str:
    rounded = round(float(amount or 0), 2)
    integer_amount = int(round(rounded))
    return f"{_financial_integer_to_text(integer_amount)}元整"


def _default_quote_dates(issue_date: date | None, expiry_date: date | None) -> tuple[date, date]:
    safe_issue = issue_date or date.today()
    safe_expiry = expiry_date or (safe_issue + timedelta(days=10))
    return safe_issue, safe_expiry


def _resolve_quote_recipient_display(quote: Quote, customer: Customer | None, contact: Contact | None) -> str:
    recipient_name = getattr(quote, "recipient_name", None)
    if recipient_name and recipient_name.strip():
        return recipient_name.strip()
    customer_name = (customer.name if customer else "") or ""
    if customer_name.strip():
        return customer_name.strip()
    contact_name = (contact.name if contact else "") or ""
    return contact_name.strip()


def _resolve_invoice_recipient_display(invoice: Invoice, customer: Customer | None, contact: Contact | None) -> str:
    quote = getattr(invoice, "quote", None)
    if quote is not None:
        resolved = _resolve_quote_recipient_display(quote, customer, contact)
        if resolved:
            return resolved
    customer_name = (customer.name if customer else "") or ""
    if customer_name.strip():
        return customer_name.strip()
    contact_name = (contact.name if contact else "") or ""
    return contact_name.strip()


def _safe_download_filename_part(raw: str | None, fallback: str = "估價單") -> str:
    source = (raw or "").strip() or fallback
    safe = re.sub(r'[\\/:*?"<>|]+', "_", source)
    safe = re.sub(r"\s+", "_", safe).strip("._")
    return safe[:80] or fallback


def _quote_task_description(quote: Quote, customer: Customer | None, contact: Contact | None) -> str:
    ordered_items = sorted(
        quote.items,
        key=lambda item: (
            item.sort_order if item.sort_order is not None else 10**9,
            item.id if item.id is not None else 10**9,
        ),
    )
    lines = [
        f"由報價單自動建立任務：{quote.quote_no}",
        f"客戶：{(customer.name if customer else '') or '-'}",
        f"聯絡人：{(contact.name if contact else '') or '-'}",
        f"報價日期：{quote.issue_date.isoformat() if quote.issue_date else '-'}",
        f"有效日期：{quote.expiry_date.isoformat() if quote.expiry_date else '-'}",
        "",
        "品項摘要：",
    ]
    for idx, item in enumerate(ordered_items[:6], start=1):
        lines.append(
            f"{idx}. {item.description or '-'} | {float(item.quantity or 0):.2f}{item.unit or ''}"
        )
    if quote.note:
        lines.extend(["", f"備註：{quote.note}"])
    return "\n".join(lines)


def _create_task_for_quote(quote: Quote, customer: Customer | None, contact: Contact | None) -> Task:
    issue_value = quote.issue_date or date.today()
    expiry_value = quote.expiry_date or (issue_value + timedelta(days=10))
    title_name = (customer.name if customer else "") or "未命名客戶"
    title = f"報價單 {quote.quote_no} - {title_name}"[:150]
    location = ((customer.address if customer else "") or "待確認地址").strip()[:255] or "待確認地址"
    expected_time = datetime.combine(issue_value, time(hour=9, minute=0))
    due_date = datetime.combine(expiry_value, time(hour=18, minute=0))

    return Task(
        title=title,
        description=_quote_task_description(quote, customer, contact),
        status="尚未接單",
        location=location,
        location_url=None,
        expected_time=expected_time,
        assigned_to_id=None,
        assigned_by_id=quote.created_by_id,
        due_date=due_date,
    )


def _find_quote_template_path() -> Path | None:
    configured = (os.environ.get("QUOTE_TEMPLATE_XLSX") or "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.exists() and candidate.is_file():
            return candidate

    backend_dir = Path(__file__).resolve().parents[1]
    data_dir = backend_dir.parent / "data"
    if not data_dir.exists():
        return None

    candidates = sorted(data_dir.glob("*.xlsx"))
    return candidates[0] if candidates else None


def _excel_text_width_units(value: object) -> int:
    width = 0
    for char in str(value or ""):
        if char == "\t":
            width += 4
        elif unicodedata.east_asian_width(char) in {"W", "F", "A"}:
            width += 2
        else:
            width += 1
    return width


def _quote_template_cell_height(ws, cell_ref: str) -> float:
    cell = ws[cell_ref]
    font_size = float(cell.font.sz or 11)
    column_width = float(ws.column_dimensions[cell.column_letter].width or 13)
    # Excel column widths are based on the default 11 pt font. Allow a small
    # margin for the cell padding and treat full-width CJK glyphs as two units.
    line_capacity = max(1.0, (column_width * 11.0 / font_size) - 1.0)
    line_count = 0
    for paragraph in str(cell.value or "").split("\n"):
        line_count += max(1, math.ceil(_excel_text_width_units(paragraph) / line_capacity))
    return (line_count * font_size * 1.2) + 3.0


def _autofit_quote_template_row(ws, row: int, cell_refs: tuple[str, ...] = ("D", "J")) -> None:
    minimum_height = float(ws.row_dimensions[row].height or ws.sheet_format.defaultRowHeight or 15)
    required_height = minimum_height
    for column in cell_refs:
        cell = ws[f"{column}{row}"]
        alignment = copy(cell.alignment)
        alignment.wrap_text = True
        cell.alignment = alignment
        if cell.value not in (None, ""):
            required_height = max(required_height, _quote_template_cell_height(ws, cell.coordinate))
    ws.row_dimensions[row].height = round(required_height, 2)


def _configure_quote_template_print_layout(ws) -> None:
    # Keep columns on one page, but let long item content continue vertically.
    # Forcing every row onto one page would make long quotes unreadably small.
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_setup.scale = None
    ws.print_title_rows = "1:6"


def _apply_quote_to_template_sheet(ws, quote: Quote, customer: Customer | None, contact: Contact | None) -> None:
    recipient = _resolve_quote_recipient_display(quote, customer, contact)
    site_address = (getattr(quote, "site_address", None) or "").strip()

    ws["D2"] = "立翔水電行"
    ws["D3"] = "估價單"
    ws["D4"] = _xlsx_safe_text(recipient)
    ws["E4"] = "台照"
    ws["D5"] = _to_roc_date_text(quote.issue_date)
    ws["D6"] = (
        _xlsx_safe_text(f"施工地點：{site_address}")
        if site_address
        else "施工地點：__________________________"
    )

    # Template reserves rows 7-26 for up to 20 line items.
    for idx, row in enumerate(range(7, 27), start=1):
        ws[f"C{row}"] = idx
        ws[f"D{row}"] = None
        ws[f"E{row}"] = None
        ws[f"F{row}"] = None
        ws[f"G{row}"] = None
        ws[f"H{row}"] = None
        ws[f"I{row}"] = 0
        ws[f"J{row}"] = None

    ordered_items = sorted(
        quote.items,
        key=lambda item: (
            item.sort_order if item.sort_order is not None else 10**9,
            item.id if item.id is not None else 10**9,
        ),
    )
    for index, item in enumerate(ordered_items[:20]):
        row = 7 + index
        ws[f"D{row}"] = _xlsx_safe_text(item.description)
        ws[f"F{row}"] = _xlsx_safe_text(item.unit or "式")
        ws[f"G{row}"] = float(item.quantity or 0)
        ws[f"H{row}"] = float(item.unit_price or 0)
        ws[f"I{row}"] = float(item.amount or 0)
        ws[f"J{row}"] = _xlsx_safe_text(item.note)
        _autofit_quote_template_row(ws, row)

    total_amount = _quote_display_total_without_tax(quote)
    ws["C27"] = "總計"
    ws["E27"] = "新台幣"
    ws["F27"] = total_amount
    ws["H27"] = "NT$"
    ws["I27"] = total_amount
    _configure_quote_template_print_layout(ws)


def _validate_customer_contact(customer_id, contact_id):
    customer = Customer.query.get(customer_id)
    if not customer:
        return None, None, (jsonify({"msg": "Customer not found"}), 404)

    contact = None
    if contact_id is not None:
        contact = Contact.query.get(contact_id)
        if not contact:
            return None, None, (jsonify({"msg": "Contact not found"}), 404)
        if contact.customer_id != customer.id:
            return None, None, (jsonify({"msg": "Contact does not belong to this customer"}), 400)

    return customer, contact, None


def _serialize_customer_service_history(customer: Customer, *, quote_limit: int = 30, invoice_limit: int = 30):
    quotes = (
        Quote.query.options(selectinload(Quote.items))
        .filter(Quote.customer_id == customer.id)
        .order_by(Quote.created_at.desc())
        .limit(quote_limit)
        .all()
    )
    return {
        "customer": customer.to_dict(),
        "quotes": [row.to_dict() for row in quotes],
        "invoices": [],
    }


def _build_pdf_document(title: str, meta_rows: list[list[str]], item_rows: list[list[str]], totals_rows: list[list[str]]):
    _require_embedded_pdf_font()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    styles["Normal"].fontName = PDF_FONT_NAME
    styles["Heading1"].fontName = PDF_FONT_NAME

    story = [
        Paragraph("立翔水電行", styles["Heading1"]),
        Paragraph(title, styles["Normal"]),
        Spacer(1, 8 * mm),
    ]

    meta_table = Table(meta_rows, hAlign="LEFT", colWidths=[45 * mm, 120 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ]
        )
    )
    story.extend([meta_table, Spacer(1, 6 * mm)])

    item_col_count = len(item_rows[0]) if item_rows else 0
    if item_col_count == 5:
        col_widths = [72 * mm, 18 * mm, 20 * mm, 30 * mm, 30 * mm]
    else:
        col_widths = [80 * mm, 25 * mm, 30 * mm, 30 * mm]
    items_table = Table(item_rows, hAlign="LEFT", colWidths=col_widths)
    items_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5f5")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ]
        )
    )
    story.extend([items_table, Spacer(1, 6 * mm)])

    totals_table = Table(totals_rows, hAlign="RIGHT", colWidths=[35 * mm, 35 * mm])
    totals_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ]
        )
    )
    totals_row_index = len(totals_rows) - 1 if totals_rows else 0
    stamp_center = _estimate_table_cell_center(
        doc,
        story,
        totals_table,
        row_index=totals_row_index,
        col_index=1,
        h_align="RIGHT",
    )
    story.append(totals_table)

    doc.build(story, canvasmaker=_make_pdf_stamp_canvasmaker(doc, stamp_center))
    buffer.seek(0)
    return buffer


def _build_quote_template_pdf(
    quote: Quote,
    customer: Customer | None,
    contact: Contact | None,
    *,
    document_label: str = "\u5831\u50f9\u55ae",
    document_title_prefix: str = "quote",
):
    _require_embedded_pdf_font()
    recipient = _resolve_quote_recipient_display(quote, customer, contact)
    site_address = (quote.site_address or "").strip()
    customer_signature_name = (getattr(quote, "customer_signature_name", None) or "").strip()
    customer_signed_at = getattr(quote, "customer_signed_at", None)
    signature_image_path = _invoice_signature_image_path(quote) if getattr(quote, "customer_signature_path", None) else None

    ordered_items = sorted(
        quote.items,
        key=lambda item: (
            item.sort_order if item.sort_order is not None else 10**9,
            item.id if item.id is not None else 10**9,
        ),
    )
    display_items: list[object] = list(ordered_items)
    tax_amount_value = float(quote.tax_amount or 0)
    tax_rate_value = float(quote.tax_rate or 0)
    if tax_rate_value > 0 and abs(tax_amount_value) > 0.0001:
        display_items.append(
            {
                "description": "稅金",
                "unit": "式",
                "quantity": 1.0,
                "unit_price": tax_amount_value,
                "amount": tax_amount_value,
            }
        )

    total_amount = _quote_display_total_without_tax(quote)
    total_amount_numeric = _format_amount_number(total_amount)
    total_amount_upper = _format_financial_amount_text(total_amount)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f"{document_title_prefix}-{quote.quote_no}",
    )

    styles = getSampleStyleSheet()
    title_style = styles["Heading1"].clone("QuoteTemplateTitle")
    title_style.fontName = PDF_FONT_NAME
    title_style.alignment = 1
    title_style.fontSize = 24
    title_style.leading = 30
    title_style.textColor = colors.HexColor("#111827")

    subtitle_style = styles["Normal"].clone("QuoteTemplateSubtitle")
    subtitle_style.fontName = PDF_FONT_NAME
    subtitle_style.alignment = 1
    subtitle_style.fontSize = 13
    subtitle_style.leading = 18
    subtitle_style.textColor = colors.HexColor("#334155")

    body_style = styles["Normal"].clone("QuoteTemplateBody")
    body_style.fontName = PDF_FONT_NAME
    body_style.fontSize = 10.5
    body_style.leading = 15
    body_style.textColor = colors.HexColor("#1f2937")
    recipient_style = styles["Normal"].clone("QuoteTemplateRecipient")
    recipient_style.fontName = PDF_FONT_NAME
    recipient_style.fontSize = 16
    recipient_style.leading = 20
    recipient_style.textColor = colors.HexColor("#0f172a")
    signer_style = styles["Normal"].clone("QuoteTemplateSigner")
    signer_style.fontName = PDF_FONT_NAME
    signer_style.alignment = 2
    signer_style.fontSize = 12
    signer_style.leading = 16
    company_meta_style = styles["Normal"].clone("QuoteTemplateCompanyMeta")
    company_meta_style.fontName = PDF_FONT_NAME
    company_meta_style.alignment = 2
    company_meta_style.fontSize = 10
    company_meta_style.leading = 12
    company_meta_style.textColor = colors.HexColor("#334155")
    item_cell_style = styles["Normal"].clone("QuoteTemplateItemCell")
    item_cell_style.fontName = PDF_FONT_NAME
    item_cell_style.fontSize = 9.5
    item_cell_style.leading = 11
    item_cell_style.textColor = colors.HexColor("#111827")
    item_cell_style.wordWrap = "CJK"
    numeric_cell_style = styles["Normal"].clone("QuoteTemplateNumericCell")
    numeric_cell_style.fontName = PDF_FONT_NAME
    numeric_cell_style.fontSize = 9
    numeric_cell_style.leading = 10
    numeric_cell_style.alignment = 2
    numeric_cell_style.textColor = colors.HexColor("#111827")

    def _table_paragraph(value: object, *, alignment: int = 0):
        text = str(value or "").strip()
        if not text:
            return ""
        cell_style = item_cell_style.clone(f"QuoteTemplateItemCell-{alignment}")
        cell_style.alignment = alignment
        return Paragraph(escape(text).replace("\n", "<br />"), cell_style)

    def _fit_numeric_cell(value: object, *, width_mm: float):
        text = str(value or "").strip()
        if not text:
            return ""
        paragraph = Paragraph(escape(text), numeric_cell_style)
        return KeepInFrame((width_mm * mm) - 3, 7 * mm, [paragraph], mode="shrink")

    story = [
        Paragraph("立翔水電行", title_style),
        Paragraph("估價單", subtitle_style),
        Spacer(1, 3 * mm),
        Paragraph(f"{recipient} 台照", recipient_style),
        Paragraph(_to_roc_date_text(quote.issue_date), body_style),
        Paragraph(f"施工地點：{site_address}" if site_address else "施工地點：__________________________", body_style),
        Spacer(1, 4 * mm),
    ]
    story[1] = Paragraph(document_label, subtitle_style)
    story.insert(0, Spacer(1, 1 * mm))
    story.insert(0, Paragraph(PDF_COMPANY_TAX_ID_TEXT, company_meta_style))

    item_rows_per_page = 20
    rows = [["項目", "項目名稱", "規格內容", "單位", "數量", "單價", "合計", "備註"]]
    first_blank_row_written = False
    trailing_stamp_safe_rows = _quote_pdf_trailing_stamp_safe_rows(display_items)
    item_row_count = _quote_pdf_item_row_count(
        len(display_items),
        item_rows_per_page,
        trailing_stamp_safe_rows=trailing_stamp_safe_rows,
    )
    for idx in range(item_row_count):
        item = display_items[idx] if idx < len(display_items) else None
        if item is None:
            blank_description = "以下空白" if not first_blank_row_written and len(display_items) > 0 else ""
            first_blank_row_written = True if blank_description else first_blank_row_written
            rows.append([str(idx + 1), blank_description, "", "", "", "", "", ""])
            continue
        if isinstance(item, dict):
            item_description = item.get("description") or ""
            item_unit = item.get("unit") or "式"
            item_note = item.get("note") or ""
            item_quantity = float(item.get("quantity") or 0)
            item_unit_price = float(item.get("unit_price") or 0)
            item_amount = float(item.get("amount") or 0)
        else:
            item_description = item.description or ""
            item_unit = item.unit or "式"
            item_note = getattr(item, "note", None) or ""
            item_quantity = float(item.quantity or 0)
            item_unit_price = float(item.unit_price or 0)
            item_amount = float(item.amount or 0)
        rows.append(
            [
                str(idx + 1),
                item_description,
                "",
                item_unit,
                f"{item_quantity:.2f}",
                _format_compact_table_number(item_unit_price),
                _format_compact_table_number(item_amount),
                item_note,
            ]
        )
    rows.append(["總計", "", "新台幣", total_amount_upper, "", "", f"NT$ {total_amount_numeric}", ""])

    for row_index in range(1, len(rows) - 1):
        rows[row_index][1] = _table_paragraph(rows[row_index][1], alignment=0)
        rows[row_index][2] = _table_paragraph(rows[row_index][2], alignment=0)
        rows[row_index][5] = _fit_numeric_cell(rows[row_index][5], width_mm=20)
        rows[row_index][6] = _fit_numeric_cell(rows[row_index][6], width_mm=20)
        rows[row_index][7] = _table_paragraph(rows[row_index][7], alignment=0)
    rows[-1][6] = _fit_numeric_cell(rows[-1][6], width_mm=20)

    col_widths = [12 * mm, 46 * mm, 28 * mm, 14 * mm, 14 * mm, 20 * mm, 20 * mm, 20 * mm]
    item_heights = _quote_pdf_item_heights(rows, col_widths, len(display_items))
    table_row_heights = _quote_pdf_row_heights(
        len(display_items),
        item_row_count,
        item_rows_per_page,
        trailing_stamp_safe_rows=trailing_stamp_safe_rows,
        item_heights=item_heights,
    )
    table = Table(
        rows,
        colWidths=col_widths,
        rowHeights=table_row_heights,
        repeatRows=1,
        hAlign="CENTER",
    )
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (3, 0), (4, -1), "CENTER"),
                ("ALIGN", (5, 0), (6, 0), "CENTER"),
                ("ALIGN", (5, 1), (6, -1), "RIGHT"),
                ("ALIGN", (7, 0), (7, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#9ca3af")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafafa")]),
                ("BACKGROUND", (5, 1), (6, -1), colors.HexColor("#fff3a3")),
                ("TOPPADDING", (1, 1), (7, -2), 4),
                ("BOTTOMPADDING", (1, 1), (7, -2), 4),
                ("FONTNAME", (0, -1), (-1, -1), PDF_FONT_NAME),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eef2ff")),
                ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.HexColor("#4b5563")),
                ("SPAN", (0, -1), (1, -1)),
                ("ALIGN", (0, -1), (1, -1), "CENTER"),
                ("SPAN", (3, -1), (5, -1)),
                ("ALIGN", (3, -1), (5, -1), "LEFT"),
                ("ALIGN", (6, -1), (6, -1), "RIGHT"),
                ("LEFTPADDING", (3, -1), (5, -1), 4),
                ("RIGHTPADDING", (3, -1), (5, -1), 2),
                ("FONTSIZE", (3, -1), (5, -1), 9),
                ("FONTSIZE", (6, -1), (6, -1), 10),
            ]
        )
    )
    first_stamp_slot, last_stamp_slot = _quote_pdf_stamp_row_range(
        len(display_items),
        item_row_count,
        item_rows_per_page,
        trailing_stamp_safe_rows=trailing_stamp_safe_rows,
    )
    first_stamp_row = first_stamp_slot + 1
    last_stamp_row = last_stamp_slot + 1
    if first_stamp_row <= last_stamp_row:
        table.setStyle(
            TableStyle(
                [("NOSPLIT", (0, first_stamp_row), (-1, last_stamp_row))]
            )
        )

    stamp_placement = None
    stamp_path = _resolve_pdf_stamp_path()
    if stamp_path:
        try:
            stamp_image = ImageReader(stamp_path)
            src_w, src_h = stamp_image.getSize()
            if src_w and src_h:
                stamp_w = PDF_STAMP_WIDTH_MM * mm
                stamp_h = stamp_w * float(src_h) / float(src_w)
                rotate_deg = _resolve_pdf_stamp_rotation_deg()
                safe_box = _find_table_label_range_box(
                    doc,
                    story,
                    table,
                    first_label=str(first_stamp_row),
                    last_label=str(last_stamp_row),
                    first_col=5,
                    last_col=7,
                )
                if safe_box:
                    stamp_placement = _fit_stamp_in_safe_box(
                        stamp_w,
                        stamp_h,
                        rotate_deg,
                        safe_box,
                        padding=QUOTE_PDF_STAMP_PADDING_MM * mm,
                    )
                    if stamp_placement is not None:
                        center_x, center_y, fitted_w, fitted_h = stamp_placement
                        stamp_placement = {
                            "center_x": center_x,
                            "center_y": center_y,
                            "stamp_w": fitted_w,
                            "stamp_h": fitted_h,
                            "target_page": int(safe_box["target_page"]),
                        }
        except Exception:
            stamp_placement = None
    if stamp_placement is None:
        stamp_placement = {"disabled": True}
    story.append(table)

    expiry_value = getattr(quote, "expiry_date", None) or quote.issue_date
    validity_date_label = "請款日期" if document_label == "請款單" else "報價日期"
    footer_date = Paragraph(f"{validity_date_label}有效期限至 {_to_month_day_text(expiry_value)}", body_style)
    footer_signer = Paragraph("經手人：莊全立", signer_style)

    if not quote.note and signature_image_path is None:
        footer_table = Table(
            [[footer_date, footer_signer]],
            colWidths=[88 * mm, 88 * mm],
            hAlign="CENTER",
        )
        footer_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        story.extend([Spacer(1, 1 * mm), footer_table])
    else:
        story.extend([Spacer(1, 2 * mm), footer_date])

    if quote.note:
        story.extend([Spacer(1, 4 * mm), Paragraph(f"備註：{quote.note}", body_style)])
    if signature_image_path is not None:
        signed_date_text = customer_signed_at.strftime("%Y-%m-%d %H:%M") if customer_signed_at else "-"
        signature_meta = f"客戶簽名：{customer_signature_name or recipient or '-'}　簽名時間：{signed_date_text}"
        story.extend([Spacer(1, 4 * mm), Paragraph(signature_meta, body_style)])
        try:
            signature_flowable = Image(signature_image_path, width=50 * mm, height=20 * mm, kind="proportional")
            signature_table = Table(
                [[signature_flowable]],
                colWidths=[55 * mm],
                rowHeights=[24 * mm],
                hAlign="LEFT",
            )
            signature_table.setStyle(
                TableStyle(
                    [
                        ("BOX", (0, 0), (0, 0), 0.8, colors.HexColor("#94a3b8")),
                        ("VALIGN", (0, 0), (0, 0), "MIDDLE"),
                        ("ALIGN", (0, 0), (0, 0), "CENTER"),
                    ]
                )
            )
            story.extend([Spacer(1, 2 * mm), signature_table])
        except Exception:
            pass
    if quote.note or signature_image_path is not None:
        story.extend([Spacer(1, 4 * mm), footer_signer])

    doc.build(story, canvasmaker=_make_pdf_stamp_canvasmaker(doc, stamp_placement))
    buffer.seek(0)
    return buffer


def _build_invoice_template_pdf(invoice: Invoice, customer: Customer | None, contact: Contact | None):
    _require_embedded_pdf_font()

    recipient = _resolve_invoice_recipient_display(invoice, customer, contact)

    ordered_items = sorted(
        invoice.items,
        key=lambda item: (
            item.sort_order if item.sort_order is not None else 10**9,
            item.id if item.id is not None else 10**9,
        ),
    )

    rows = [["項次", "項目名稱", "規格內容", "單位", "數量", "單價", "金額", "備註"]]
    for idx in range(20):
        item = ordered_items[idx] if idx < len(ordered_items) else None
        if item is None:
            rows.append([str(idx + 1), "", "", "", "", "", "", ""])
            continue
        rows.append(
            [
                str(idx + 1),
                item.description or "",
                "",
                item.unit or "",
                f"{float(item.quantity or 0):.2f}",
                f"{float(item.unit_price or 0):.2f}",
                f"{float(item.amount or 0):.2f}",
                "",
            ]
        )

    total_amount = _invoice_display_total_without_tax(invoice)
    rows.append(
        [
            "合計",
            "",
            "新台幣",
            f"{total_amount:.2f}",
            "",
            "NT$",
            f"{total_amount:.2f}",
            "",
        ]
    )

    issue_date_text = _to_roc_date_text(invoice.issue_date)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=f"invoice-{invoice.invoice_no}",
    )

    styles = getSampleStyleSheet()
    title_style = styles["Heading1"].clone("InvoiceTemplateTitle")
    title_style.fontName = PDF_FONT_NAME
    title_style.alignment = 1
    title_style.fontSize = 18
    title_style.leading = 22

    subtitle_style = styles["Normal"].clone("InvoiceTemplateSubtitle")
    subtitle_style.fontName = PDF_FONT_NAME
    subtitle_style.alignment = 1
    subtitle_style.fontSize = 12
    subtitle_style.leading = 16

    body_style = styles["Normal"].clone("InvoiceTemplateBody")
    body_style.fontName = PDF_FONT_NAME
    body_style.fontSize = 10
    body_style.leading = 14

    story = [
        Paragraph("立翔水電行", title_style),
        Paragraph("發票", subtitle_style),
        Spacer(1, 3 * mm),
        Paragraph(f"{recipient} 台照", body_style),
        Paragraph(issue_date_text, body_style),
        Paragraph(f"單號：{invoice.invoice_no}", body_style),
        Spacer(1, 4 * mm),
    ]

    table = Table(
        rows,
        colWidths=[12 * mm, 46 * mm, 28 * mm, 14 * mm, 14 * mm, 20 * mm, 20 * mm, 20 * mm],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), PDF_FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (3, 0), (5, -1), "CENTER"),
                ("ALIGN", (6, 0), (6, -1), "RIGHT"),
                ("ALIGN", (7, 0), (7, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#9ca3af")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#fafafa")]),
                ("FONTNAME", (0, -1), (-1, -1), PDF_FONT_NAME),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eef2ff")),
                ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.HexColor("#4b5563")),
            ]
        )
    )
    totals_row_index = len(rows) - 1 if rows else 0
    stamp_center = _estimate_table_cell_center(
        doc,
        story,
        table,
        row_index=totals_row_index,
        col_index=6,
        h_align="LEFT",
    )
    story.append(table)

    if invoice.note:
        story.extend([Spacer(1, 4 * mm), Paragraph(f"備註：{invoice.note}", body_style)])

    doc.build(story, canvasmaker=_make_pdf_stamp_canvasmaker(doc, stamp_center))
    buffer.seek(0)
    return buffer


def _build_invoice_template_pdf(invoice: Invoice, customer: Customer | None, contact: Contact | None):
    quote_like = SimpleNamespace(
        quote_no=invoice.invoice_no,
        recipient_name=_resolve_invoice_recipient_display(invoice, customer, contact),
        issue_date=invoice.issue_date,
        expiry_date=invoice.due_date,
        tax_rate=invoice.tax_rate,
        tax_amount=invoice.tax_amount,
        total_amount=invoice.total_amount,
        subtotal=invoice.subtotal,
        note=invoice.note,
        site_address=(invoice.quote.site_address if invoice.quote else None),
        customer_signature_path=invoice.customer_signature_path,
        customer_signature_name=invoice.customer_signature_name,
        customer_signed_at=invoice.customer_signed_at,
        items=[
            SimpleNamespace(
                id=item.id,
                sort_order=item.sort_order,
                description=item.description,
                unit=item.unit,
                note="",
                quantity=item.quantity,
                unit_price=item.unit_price,
                amount=item.amount,
            )
            for item in (invoice.items or [])
        ],
    )
    return _build_quote_template_pdf(
        quote_like,
        customer,
        contact,
        document_label="\u8acb\u6b3e\u55ae",
        document_title_prefix="invoice",
    )


def _trim(value):
    return (value or "").strip()


def _append_note(original: str | None, extra: str) -> str:
    current = _trim(original)
    return f"{current}\n{extra}" if current else extra


def _find_or_create_customer(name: str, phone: str, email: str, address: str, note_line: str):
    customer = None
    if phone:
        customer = Customer.query.filter(Customer.phone == phone).first()
    if not customer and email:
        customer = Customer.query.filter(Customer.email == email).first()
    if not customer and name:
        customer = Customer.query.filter(Customer.name == name).first()

    if customer:
        if phone and not customer.phone:
            customer.phone = phone
        if email and not customer.email:
            customer.email = email
        if address and not customer.address:
            customer.address = address
        customer.note = _append_note(customer.note, note_line)
        return customer

    base_name = name or f"WebBooking-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    candidate = base_name
    suffix = 2
    while Customer.query.filter(Customer.name == candidate).first():
        candidate = f"{base_name}-{suffix}"
        suffix += 1

    customer = Customer(
        name=candidate,
        email=email or None,
        phone=phone or None,
        address=address or None,
        note=note_line,
        created_by_id=None,
    )
    db.session.add(customer)
    db.session.flush()
    return customer


def _find_or_create_contact(customer: Customer, name: str, phone: str, email: str, note_line: str):
    contact = None
    if email:
        contact = Contact.query.filter(
            Contact.customer_id == customer.id,
            Contact.email == email,
        ).first()
    if not contact and phone:
        contact = Contact.query.filter(
            Contact.customer_id == customer.id,
            Contact.phone == phone,
            Contact.name == name,
        ).first()

    if contact:
        if phone and not contact.phone:
            contact.phone = phone
        if email and not contact.email:
            contact.email = email
        contact.note = _append_note(contact.note, note_line)
        return contact

    is_primary = Contact.query.filter(Contact.customer_id == customer.id).count() == 0
    contact = Contact(
        customer_id=customer.id,
        name=name or customer.name,
        email=email or None,
        phone=phone or None,
        is_primary=is_primary,
        note=note_line,
    )
    db.session.add(contact)
    db.session.flush()
    return contact


def _ensure_website_booking_table() -> None:
    inspector = inspect(db.engine)
    if "website_booking" in inspector.get_table_names():
        return
    WebsiteBooking.__table__.create(bind=db.engine, checkfirst=True)


def _normalize_website_booking_type(raw_value: str | None) -> str:
    value = _trim(raw_value).lower()
    return value if value in VALID_WEBSITE_BOOKING_TYPES else "booking"


def _normalize_website_booking_status(raw_value: str | None, *, fallback: str = "pending") -> str:
    value = _trim(raw_value).lower()
    return value if value in VALID_WEBSITE_BOOKING_STATUS else fallback


def _website_booking_status_counts(rows: list[WebsiteBooking]) -> dict[str, int]:
    counts = {key: 0 for key in VALID_WEBSITE_BOOKING_STATUS}
    for row in rows:
        counts[_normalize_website_booking_status(getattr(row, "status", None))] += 1
    return counts


@crm_bp.post("/public/bookings")
@rate_limit("public-booking", limit=10, window_seconds=3600)
def create_public_booking():
    _ensure_website_booking_table()
    data = request.get_json(silent=True) or {}
    name = _trim(data.get("name"))
    phone = _trim(data.get("phone"))
    email = _trim(data.get("email"))
    service = _trim(data.get("service")) or "一般諮詢"
    inquiry_type = _normalize_website_booking_type(data.get("inquiry_type"))
    preferred_time = _trim(data.get("preferred_time"))
    budget_range = _trim(data.get("budget_range"))
    message = _trim(data.get("message"))
    address = _trim(data.get("address"))
    source_url = _trim(data.get("source_url")) or _trim(request.referrer)
    source_channel = _trim(data.get("source_channel")) or "website"
    user_agent = _trim(request.headers.get("User-Agent"))
    client_ip = _trim((request.headers.get("X-Forwarded-For") or "").split(",")[0]) or _trim(request.remote_addr)

    field_limits = {
        "name": (name, 255),
        "phone": (phone, 64),
        "email": (email, 255),
        "service": (service, 255),
        "preferred_time": (preferred_time, 120),
        "budget_range": (budget_range, 120),
        "source_channel": (source_channel, 64),
        "message": (message, 4000),
        "address": (address, 2000),
    }
    for field_name, (value, maximum) in field_limits.items():
        if len(value) > maximum:
            return jsonify({"msg": f"{field_name} must not exceed {maximum} characters"}), 400

    # Request metadata is diagnostic only; bound it instead of allowing spoofed
    # headers to cause database errors or unbounded storage growth.
    source_url = source_url[:2048]
    user_agent = user_agent[:512]
    client_ip = client_ip[:64]

    if not name:
        return jsonify({"msg": "name is required"}), 400
    if not phone:
        return jsonify({"msg": "phone is required"}), 400
    if inquiry_type in {"booking", "quote"} and not address:
        return jsonify({"msg": "address is required"}), 400
    merged_message = message
    if preferred_time:
        merged_message = f"聯絡時段: {preferred_time}" + (f"\n{message}" if message else "")

    booking = WebsiteBooking(
        name=name,
        phone=phone,
        email=email,
        service=service,
        inquiry_type=inquiry_type,
        preferred_time=preferred_time or None,
        budget_range=budget_range or None,
        source_channel=source_channel,
        message=merged_message,
        address=address,
        source_url=source_url,
        user_agent=user_agent,
        client_ip=client_ip,
        status="pending",
    )
    db.session.add(booking)
    db.session.commit()

    return (
        jsonify(
            {
                "msg": "booking received",
                "booking_id": booking.id,
            }
        ),
        201,
    )


@crm_bp.get("/public-bookings")
@role_required(*READ_ROLES)
def list_public_bookings():
    _ensure_website_booking_table()
    status = _trim(request.args.get("status"))
    inquiry_type = request.args.get("inquiry_type")
    q = _trim(request.args.get("q"))

    query = WebsiteBooking.query.order_by(WebsiteBooking.created_at.desc(), WebsiteBooking.id.desc())
    if status in VALID_WEBSITE_BOOKING_STATUS:
        query = query.filter(WebsiteBooking.status == status)
    if inquiry_type:
        query = query.filter(WebsiteBooking.inquiry_type == _normalize_website_booking_type(inquiry_type))
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            (WebsiteBooking.name.ilike(pattern))
            | (WebsiteBooking.phone.ilike(pattern))
            | (WebsiteBooking.email.ilike(pattern))
            | (WebsiteBooking.service.ilike(pattern))
            | (WebsiteBooking.address.ilike(pattern))
        )
    rows = query.limit(500).all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.put("/public-bookings/<int:booking_id>")
@role_required(*WRITE_ROLES)
def update_public_booking(booking_id: int):
    _ensure_website_booking_table()
    booking = WebsiteBooking.query.get_or_404(booking_id)
    before_snapshot = booking.to_dict()
    data = request.get_json(silent=True) or {}

    if "status" in data:
        booking.status = _normalize_website_booking_status(data.get("status"), fallback=booking.status or "pending")
        if booking.status in {"contacted", "quoted"}:
            booking.last_contacted_at = datetime.utcnow()
        if booking.status == "closed":
            booking.closed_at = datetime.utcnow()
        elif booking.status != "closed":
            booking.closed_at = None
    if "follow_up_note" in data:
        booking.follow_up_note = _trim(data.get("follow_up_note")) or None
    if "service" in data:
        booking.service = _trim(data.get("service")) or booking.service
    if "preferred_time" in data:
        booking.preferred_time = _trim(data.get("preferred_time")) or None
    if "budget_range" in data:
        booking.budget_range = _trim(data.get("budget_range")) or None

    after_snapshot = booking.to_dict()
    changes = _audit_field_changes(
        before_snapshot,
        after_snapshot,
        fields=["status", "follow_up_note", "service", "preferred_time", "budget_range", "last_contacted_at", "closed_at"],
    )
    if changes:
        _append_audit_log(
            action="website_lead_update",
            entity_type="website_booking",
            entity_id=booking.id,
            entity_label=f"Lead #{booking.id}",
            details={"changes": changes, "after": after_snapshot},
            note="Updated website lead",
        )
    db.session.commit()
    return jsonify(booking.to_dict())


@crm_bp.post("/public-bookings/<int:booking_id>/convert")
@role_required(*WRITE_ROLES)
def convert_public_booking_to_customer(booking_id: int):
    _ensure_website_booking_table()
    booking = WebsiteBooking.query.get_or_404(booking_id)
    if booking.status == "converted" and booking.converted_customer_id:
        return jsonify(
            {
                "msg": "already converted",
                "booking": booking.to_dict(),
            }
        )

    note_parts = [
        "Source: website booking",
        f"Booking ID: {booking.id}",
    ]
    if booking.inquiry_type:
        note_parts.append(f"Type: {booking.inquiry_type}")
    if booking.service and booking.service != "一般諮詢":
        note_parts.append(f"Service: {booking.service}")
    if booking.preferred_time:
        note_parts.append(f"Preferred time: {booking.preferred_time}")
    if booking.budget_range:
        note_parts.append(f"Budget: {booking.budget_range}")
    if booking.message:
        note_parts.append(f"Message: {booking.message}")
    if booking.source_url:
        note_parts.append(f"Source URL: {booking.source_url}")
    if booking.client_ip:
        note_parts.append(f"IP: {booking.client_ip}")
    if booking.user_agent:
        note_parts.append(f"UA: {booking.user_agent}")
    note_line = "\n".join(note_parts)
    # Keep customer/contact notes concise; technical metadata stays in booking record.
    note_parts = [f"網站預約轉入（#{booking.id}）"]
    if booking.inquiry_type:
        note_parts.append(f"類型：{booking.inquiry_type}")
    if booking.message:
        note_parts.append(booking.message)
    note_line = "\n".join(note_parts)

    customer = _find_or_create_customer(
        name=booking.name,
        phone=booking.phone,
        email=booking.email or "",
        address=booking.address or "",
        note_line=note_line,
    )
    contact = _find_or_create_contact(
        customer=customer,
        name=booking.name,
        phone=booking.phone,
        email=booking.email or "",
        note_line=note_line,
    )

    booking.status = "converted"
    booking.converted_customer_id = customer.id
    booking.converted_contact_id = contact.id
    booking.converted_by_id = get_current_user_id()
    booking.converted_at = datetime.utcnow()
    booking.last_contacted_at = booking.last_contacted_at or booking.converted_at
    booking.closed_at = None
    _append_audit_log(
        action="website_lead_convert",
        entity_type="website_booking",
        entity_id=booking.id,
        entity_label=f"Lead #{booking.id}",
        details={
            "booking": booking.to_dict(),
            "customer_id": customer.id,
            "customer_name": customer.name,
            "contact_id": contact.id,
            "contact_name": contact.name,
        },
        note="Converted website lead to customer",
    )
    db.session.commit()

    return jsonify(
        {
            "msg": "booking converted",
            "booking": booking.to_dict(),
            "customer": customer.to_dict(),
            "contact": contact.to_dict(),
        }
    )


@crm_bp.get("/lead-metrics")
@role_required(*READ_ROLES)
def website_lead_metrics():
    _ensure_website_booking_table()
    days = request.args.get("days", default=180, type=int) or 180
    days = max(30, min(days, 365))
    start_at = datetime.utcnow() - timedelta(days=days)

    leads = (
        WebsiteBooking.query.filter(WebsiteBooking.created_at >= start_at)
        .order_by(WebsiteBooking.created_at.desc(), WebsiteBooking.id.desc())
        .all()
    )
    quotes = Quote.query.filter(Quote.created_at >= start_at).all()
    invoices = Invoice.query.filter(Invoice.created_at >= start_at).all()

    status_counts = _website_booking_status_counts(leads)
    type_counts = {key: 0 for key in VALID_WEBSITE_BOOKING_TYPES}
    for row in leads:
        type_counts[_normalize_website_booking_type(getattr(row, "inquiry_type", None))] += 1

    conversion_count = status_counts.get("converted", 0)
    conversion_rate = round((conversion_count / len(leads)) * 100.0, 2) if leads else 0.0
    recent_30d_start = datetime.utcnow() - timedelta(days=30)

    monthly_map: dict[str, dict[str, object]] = {}
    today_month = date.today().month
    today_year = date.today().year
    for offset in range(5, -1, -1):
        month_index = (today_year * 12 + today_month - 1) - offset
        year = month_index // 12
        month = month_index % 12 + 1
        month_pointer = date(year, month, 1)
        month_key = month_pointer.strftime("%Y-%m")
        monthly_map[month_key] = {"month": month_key, "leads": 0, "converted": 0, "quotes": 0, "invoice_total": 0.0}

    for row in leads:
        month_key = (row.created_at or datetime.utcnow()).strftime("%Y-%m")
        monthly_map.setdefault(month_key, {"month": month_key, "leads": 0, "converted": 0, "quotes": 0, "invoice_total": 0.0})
        monthly_map[month_key]["leads"] += 1
        if row.status == "converted":
            monthly_map[month_key]["converted"] += 1

    for row in quotes:
        month_key = (row.created_at or datetime.utcnow()).strftime("%Y-%m")
        monthly_map.setdefault(month_key, {"month": month_key, "leads": 0, "converted": 0, "quotes": 0, "invoice_total": 0.0})
        monthly_map[month_key]["quotes"] += 1

    for row in invoices:
        month_key = (row.created_at or datetime.utcnow()).strftime("%Y-%m")
        monthly_map.setdefault(month_key, {"month": month_key, "leads": 0, "converted": 0, "quotes": 0, "invoice_total": 0.0})
        monthly_map[month_key]["invoice_total"] += float(row.total_amount or 0.0)

    return jsonify(
        {
            "range_days": days,
            "summary": {
                "total_leads": len(leads),
                "recent_30d_leads": sum(1 for row in leads if row.created_at and row.created_at >= recent_30d_start),
                "pending_leads": status_counts.get("pending", 0),
                "contacted_leads": status_counts.get("contacted", 0),
                "quoted_leads": status_counts.get("quoted", 0),
                "converted_leads": conversion_count,
                "closed_leads": status_counts.get("closed", 0),
                "conversion_rate": conversion_rate,
                "quote_count": len(quotes),
                "quote_total": round(sum(float(row.total_amount or 0.0) for row in quotes), 2),
                "invoice_count": len(invoices),
                "invoice_total": round(sum(float(row.total_amount or 0.0) for row in invoices), 2),
                "paid_total": round(sum(float(_invoice_payment_total(row) or 0.0) for row in invoices), 2),
            },
            "by_type": [{"type": key, "count": type_counts.get(key, 0)} for key in sorted(type_counts.keys())],
            "by_status": [{"status": key, "count": status_counts.get(key, 0)} for key in sorted(status_counts.keys())],
            "monthly": sorted(monthly_map.values(), key=lambda item: item["month"]),
        }
    )


@crm_bp.get("/catalog-items")
@role_required(*READ_ROLES)
def list_catalog_items():
    q = (request.args.get("q") or "").strip()
    include_inactive = request.args.get("include_inactive", "false").strip().lower() == "true"

    query = ServiceCatalogItem.query.order_by(ServiceCatalogItem.updated_at.desc())
    if not include_inactive:
        query = query.filter(ServiceCatalogItem.is_active.is_(True))
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            (ServiceCatalogItem.name.ilike(pattern))
            | (ServiceCatalogItem.category.ilike(pattern))
        )
    rows = query.limit(500).all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.post("/catalog-items")
@role_required(*WRITE_ROLES)
def create_catalog_item():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "name is required"}), 400

    unit = (data.get("unit") or "").strip() or "式"
    unit_price, unit_price_err = _parse_float(data.get("unit_price", 0), "unit_price", minimum=0)
    if unit_price_err:
        return unit_price_err

    exists = ServiceCatalogItem.query.filter(ServiceCatalogItem.name == name).first()
    if exists:
        return jsonify({"msg": "catalog item name already exists"}), 400

    item = ServiceCatalogItem(
        name=name,
        unit=unit,
        unit_price=unit_price or 0.0,
        category=(data.get("category") or "").strip() or None,
        note=(data.get("note") or "").strip() or None,
        is_active=bool(data.get("is_active", True)),
    )
    db.session.add(item)
    db.session.flush()
    _append_audit_log(
        action="catalog_item_create",
        entity_type="catalog_item",
        entity_id=item.id,
        entity_label=item.name,
        details={"after": item.to_dict()},
    )
    db.session.commit()
    return jsonify(item.to_dict()), 201


@crm_bp.put("/catalog-items/<int:item_id>")
@role_required(*WRITE_ROLES)
def update_catalog_item(item_id: int):
    item = ServiceCatalogItem.query.get_or_404(item_id)
    before_snapshot = item.to_dict()
    data = request.get_json() or {}

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"msg": "name is required"}), 400
        duplicate = ServiceCatalogItem.query.filter(
            ServiceCatalogItem.name == name,
            ServiceCatalogItem.id != item.id,
        ).first()
        if duplicate:
            return jsonify({"msg": "catalog item name already exists"}), 400
        item.name = name

    if "unit" in data:
        item.unit = (data.get("unit") or "").strip() or "式"

    if "unit_price" in data:
        unit_price, unit_price_err = _parse_float(data.get("unit_price"), "unit_price", minimum=0)
        if unit_price_err:
            return unit_price_err
        item.unit_price = unit_price or 0.0

    if "category" in data:
        item.category = (data.get("category") or "").strip() or None
    if "note" in data:
        item.note = (data.get("note") or "").strip() or None
    if "is_active" in data:
        item.is_active = bool(data.get("is_active"))

    after_snapshot = item.to_dict()
    changes = _audit_field_changes(
        before_snapshot,
        after_snapshot,
        fields=["name", "unit", "unit_price", "category", "note", "is_active"],
    )
    if changes:
        action = "catalog_item_toggle" if set(changes.keys()) == {"is_active"} else "catalog_item_update"
        _append_audit_log(
            action=action,
            entity_type="catalog_item",
            entity_id=item.id,
            entity_label=item.name,
            details={"changes": changes},
            note="價目品項更新",
        )
    db.session.commit()
    return jsonify(item.to_dict())


@crm_bp.delete("/catalog-items/<int:item_id>")
@role_required(*WRITE_ROLES)
def delete_catalog_item(item_id: int):
    item = ServiceCatalogItem.query.get_or_404(item_id)
    snapshot = item.to_dict()
    _append_audit_log(
        action="catalog_item_delete",
        entity_type="catalog_item",
        entity_id=item.id,
        entity_label=item.name,
        details={"before": snapshot},
    )
    db.session.delete(item)
    db.session.commit()
    return jsonify({"msg": "catalog item deleted", "id": item_id})


@crm_bp.get("/customers/<int:customer_id>/service-history")
@role_required(*READ_ROLES)
def customer_service_history(customer_id: int):
    customer = Customer.query.get_or_404(customer_id)
    quote_limit = request.args.get("quote_limit", default=50, type=int) or 50
    quote_limit = max(1, min(quote_limit, 200))
    return jsonify(_serialize_customer_service_history(customer, quote_limit=quote_limit, invoice_limit=0))


@crm_bp.get("/service-history")
@role_required(*READ_ROLES)
def search_service_history():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"msg": "q is required"}), 400

    pattern = f"%{q}%"
    customers = (
        Customer.query.filter(
            (Customer.name.ilike(pattern))
            | (Customer.phone.ilike(pattern))
            | (Customer.email.ilike(pattern))
        )
        .order_by(Customer.updated_at.desc())
        .limit(20)
        .all()
    )
    result = []
    for customer in customers:
        result.append(_serialize_customer_service_history(customer, quote_limit=10, invoice_limit=0))
    return jsonify(result)


@crm_bp.get("/customers")
@role_required(*READ_ROLES)
def list_customers():
    q = (request.args.get("q") or "").strip()
    query = Customer.query.order_by(Customer.updated_at.desc())
    if q:
        pattern = f"%{q}%"
        query = query.filter(Customer.name.ilike(pattern))
    customers = query.limit(200).all()
    return jsonify([item.to_dict() for item in customers])


@crm_bp.post("/customers")
@role_required(*WRITE_ROLES)
def create_customer():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "客戶名稱為必填"}), 400

    exists = Customer.query.filter(func.lower(Customer.name) == name.lower()).first()
    if exists:
        return jsonify({"msg": f"客戶「{name}」已存在，請搜尋後編輯既有客戶。"}), 400

    customer = Customer(
        name=name,
        tax_id=(data.get("tax_id") or "").strip() or None,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        address=(data.get("address") or "").strip() or None,
        note=(data.get("note") or "").strip() or None,
        created_by_id=get_current_user_id(),
    )
    db.session.add(customer)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"msg": f"客戶「{name}」已存在，請搜尋後編輯既有客戶。"}), 400
    return jsonify(customer.to_dict()), 201


@crm_bp.get("/customers/<int:customer_id>")
@role_required(*READ_ROLES)
def get_customer(customer_id: int):
    customer = Customer.query.get_or_404(customer_id)
    payload = customer.to_dict()
    payload["contacts"] = [contact.to_dict() for contact in customer.contacts]
    return jsonify(payload)


@crm_bp.get("/audit-logs")
@role_required(*READ_ROLES)
def list_audit_logs():
    query = AuditLog.query.options(selectinload(AuditLog.actor)).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())

    module = (request.args.get("module") or "").strip().lower()
    entity_type = (request.args.get("entity_type") or "").strip().lower()
    action = (request.args.get("action") or "").strip().lower()
    entity_id = (request.args.get("entity_id") or "").strip()
    limit = request.args.get("limit", default=100, type=int) or 100
    limit = max(1, min(limit, 500))

    if module:
        query = query.filter(AuditLog.module == module)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)

    rows = query.limit(limit).all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.put("/customers/<int:customer_id>")
@role_required(*WRITE_ROLES)
def update_customer(customer_id: int):
    customer = Customer.query.get_or_404(customer_id)
    data = request.get_json() or {}

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"msg": "客戶名稱為必填"}), 400
        duplicate = Customer.query.filter(
            func.lower(Customer.name) == name.lower(),
            Customer.id != customer_id,
        ).first()
        if duplicate:
            return jsonify({"msg": f"客戶「{name}」已存在，請搜尋後編輯既有客戶。"}), 400
        customer.name = name

    for key in ("tax_id", "email", "phone", "address", "note"):
        if key in data:
            value = data.get(key)
            customer.__setattr__(key, (value or "").strip() or None)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"msg": f"客戶「{customer.name}」已存在，請搜尋後編輯既有客戶。"}), 400
    return jsonify(customer.to_dict())


@crm_bp.get("/contacts")
@role_required(*READ_ROLES)
def list_contacts():
    customer_id = request.args.get("customer_id", type=int)
    query = Contact.query.order_by(Contact.updated_at.desc())
    if customer_id:
        query = query.filter(Contact.customer_id == customer_id)
    contacts = query.limit(300).all()
    return jsonify([item.to_dict() for item in contacts])


@crm_bp.post("/contacts")
@role_required(*WRITE_ROLES)
def create_contact():
    data = request.get_json() or {}
    customer_id = data.get("customer_id")
    name = (data.get("name") or "").strip()

    if not customer_id:
        return jsonify({"msg": "customer_id is required"}), 400
    if not name:
        return jsonify({"msg": "name is required"}), 400

    customer = Customer.query.get(customer_id)
    if not customer:
        return jsonify({"msg": "Customer not found"}), 404

    contact = Contact(
        customer_id=customer.id,
        name=name,
        title=(data.get("title") or "").strip() or None,
        email=(data.get("email") or "").strip() or None,
        phone=(data.get("phone") or "").strip() or None,
        is_primary=bool(data.get("is_primary")),
        note=(data.get("note") or "").strip() or None,
    )
    db.session.add(contact)
    db.session.commit()
    return jsonify(contact.to_dict()), 201


@crm_bp.put("/contacts/<int:contact_id>")
@role_required(*WRITE_ROLES)
def update_contact(contact_id: int):
    contact = Contact.query.get_or_404(contact_id)
    data = request.get_json() or {}

    if "customer_id" in data:
        next_customer = Customer.query.get(data.get("customer_id"))
        if not next_customer:
            return jsonify({"msg": "Customer not found"}), 404
        contact.customer_id = next_customer.id

    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"msg": "name is required"}), 400
        contact.name = name

    for key in ("title", "email", "phone", "note"):
        if key in data:
            value = data.get(key)
            contact.__setattr__(key, (value or "").strip() or None)

    if "is_primary" in data:
        contact.is_primary = bool(data.get("is_primary"))

    db.session.commit()
    return jsonify(contact.to_dict())


@crm_bp.get("/quotes")
@role_required(*READ_ROLES)
def list_quotes():
    query = Quote.query.options(selectinload(Quote.items)).order_by(Quote.updated_at.desc())
    customer_id = request.args.get("customer_id", type=int)
    status = (request.args.get("status") or "").strip().lower()
    limit = _normalize_limit_arg(request.args.get("limit"), default=5, maximum=200)

    if customer_id:
        query = query.filter(Quote.customer_id == customer_id)
    if status:
        query = query.filter(Quote.status == status)

    rows = query.limit(limit).all() if limit is not None else query.all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.get("/quotes/item-usage")
@role_required(*READ_ROLES)
def search_quote_item_usage():
    raw_keyword = (request.args.get("q") or "").strip()
    catalog_item_id = request.args.get("catalog_item_id", type=int)
    raw_item_name = (request.args.get("item_name") or "").strip()
    limit = _normalize_limit_arg(request.args.get("limit"), default=30, maximum=200)

    catalog_item = None
    item_name = raw_item_name
    if catalog_item_id:
        catalog_item = ServiceCatalogItem.query.get(catalog_item_id)
        if not catalog_item:
            return jsonify({"msg": "Catalog item not found"}), 404
        item_name = (catalog_item.name or "").strip()

    if not item_name and not raw_keyword:
        return jsonify({"msg": "item_name or q is required"}), 400

    query = (
        QuoteItem.query.join(QuoteItem.quote)
        .options(
            selectinload(QuoteItem.quote).selectinload(Quote.customer),
            selectinload(QuoteItem.quote).selectinload(Quote.contact),
            selectinload(QuoteItem.quote).selectinload(Quote.invoices),
        )
        .order_by(Quote.updated_at.desc(), Quote.id.desc(), QuoteItem.sort_order.asc(), QuoteItem.id.asc())
    )

    if item_name:
        normalized_item_name = item_name.lower()
        query = query.filter(func.lower(func.trim(QuoteItem.description)) == normalized_item_name)

    if raw_keyword:
        pattern = f"%{raw_keyword}%"
        query = query.filter((QuoteItem.description.ilike(pattern)) | (QuoteItem.note.ilike(pattern)))

    rows = query.limit(limit).all() if limit is not None else query.all()

    grouped_results: OrderedDict[int, dict] = OrderedDict()
    for row in rows:
        quote = row.quote
        if quote is None:
            continue
        entry = grouped_results.get(quote.id)
        if entry is None:
            active_invoice = next(
                (
                    invoice
                    for invoice in sorted(
                        quote.invoices or [],
                        key=lambda item: (item.created_at or datetime.min, item.id or 0),
                        reverse=True,
                    )
                    if (invoice.status or "").lower() != "cancelled"
                ),
                None,
            )
            entry = {
                "quote": {
                    "id": quote.id,
                    "quote_no": quote.quote_no,
                    "status": quote.status,
                    "customer_id": quote.customer_id,
                    "contact_id": quote.contact_id,
                    "customer_name": quote.customer.name if quote.customer else None,
                    "contact_name": quote.contact.name if quote.contact else None,
                    "recipient_name": quote.recipient_name,
                    "issue_date": quote.issue_date.isoformat() if quote.issue_date else None,
                    "expiry_date": quote.expiry_date.isoformat() if quote.expiry_date else None,
                    "total_amount": round(float(quote.total_amount or 0.0), 2),
                    "updated_at": quote.updated_at.isoformat() if quote.updated_at else None,
                    "active_invoice": (
                        {
                            "id": active_invoice.id,
                            "invoice_no": active_invoice.invoice_no,
                            "status": active_invoice.status,
                        }
                        if active_invoice
                        else None
                    ),
                },
                "matched_items": [],
            }
            grouped_results[quote.id] = entry

        entry["matched_items"].append(
            {
                "id": row.id,
                "description": row.description,
                "unit": row.unit,
                "note": row.note,
                "quantity": round(float(row.quantity or 0.0), 4),
                "unit_price": round(float(row.unit_price or 0.0), 2),
                "amount": round(float(row.amount or 0.0), 2),
                "sort_order": row.sort_order,
            }
        )

    return jsonify(
        {
            "criteria": {
                "catalog_item_id": catalog_item.id if catalog_item else None,
                "item_name": item_name or None,
                "q": raw_keyword or None,
            },
            "total_quotes": len(grouped_results),
            "total_matches": len(rows),
            "results": list(grouped_results.values()),
        }
    )


@crm_bp.post("/quotes")
@role_required(*WRITE_ROLES)
def create_quote():
    data = request.get_json() or {}
    customer_id = data.get("customer_id")
    contact_id = data.get("contact_id")
    status = (data.get("status") or "draft").strip().lower()
    if status not in VALID_QUOTE_STATUS:
        return jsonify({"msg": "Invalid quote status"}), 400

    if not customer_id:
        return jsonify({"msg": "customer_id is required"}), 400
    customer, contact, cc_err = _validate_customer_contact(customer_id, contact_id)
    if cc_err:
        return cc_err

    items, items_err = _normalize_items(data.get("items"))
    if items_err:
        return items_err

    issue_date, issue_err = _parse_date(data.get("issue_date"), "issue_date")
    if issue_err:
        return issue_err
    expiry_date, expiry_err = _parse_date(data.get("expiry_date"), "expiry_date")
    if expiry_err:
        return expiry_err
    issue_date, expiry_date = _default_quote_dates(issue_date, expiry_date)

    quote = Quote(
        quote_no=(data.get("quote_no") or "").strip() or _next_quote_no(),
        status=status,
        customer_id=customer_id,
        contact_id=contact_id,
        recipient_name=(data.get("recipient_name") or "").strip() or None,
        site_address=(data.get("site_address") or "").strip() or None,
        issue_date=issue_date,
        expiry_date=expiry_date,
        currency=(data.get("currency") or "TWD").strip().upper() or "TWD",
        note=(data.get("note") or "").strip() or None,
        created_by_id=get_current_user_id(),
    )

    total_err = _apply_totals(quote, items, data.get("tax_rate", 0))
    if total_err:
        return total_err

    db.session.add(quote)
    db.session.flush()

    for item in items:
        db.session.add(QuoteItem(quote_id=quote.id, **item))

    _sync_quote_items_to_catalog(items)

    db.session.flush()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    if quote:
        _append_quote_version_snapshot(quote, action="create", summary="Initial quote created")
        db.session.add(_create_task_for_quote(quote, customer, contact))

    db.session.commit()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    return jsonify(quote.to_dict() if quote else {}), 201


@crm_bp.put("/quotes/<int:quote_id>")
@role_required(*WRITE_ROLES)
def update_quote(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    data = request.get_json() or {}
    active_invoice = _active_invoice_for_quote(quote.id)
    if active_invoice is not None:
        return (
            jsonify(
                {
                    "msg": f"此報價單已轉成請款單 {active_invoice.invoice_no}，請先取消請款單再編輯報價單。",
                    "invoice_id": active_invoice.id,
                    "invoice_no": active_invoice.invoice_no,
                }
            ),
            409,
        )

    if "status" in data:
        status = (data.get("status") or "").strip().lower()
        if status not in VALID_QUOTE_STATUS:
            return jsonify({"msg": "Invalid quote status"}), 400
        quote.status = status

    next_customer_id = data.get("customer_id", quote.customer_id)
    next_contact_id = data.get("contact_id", quote.contact_id)
    _, _, cc_err = _validate_customer_contact(next_customer_id, next_contact_id)
    if cc_err:
        return cc_err
    quote.customer_id = next_customer_id
    quote.contact_id = next_contact_id

    if "issue_date" in data:
        parsed, err = _parse_date(data.get("issue_date"), "issue_date")
        if err:
            return err
        quote.issue_date = parsed

    if "expiry_date" in data:
        parsed, err = _parse_date(data.get("expiry_date"), "expiry_date")
        if err:
            return err
        quote.expiry_date = parsed

    if "currency" in data:
        quote.currency = (data.get("currency") or "TWD").strip().upper() or "TWD"
    if "recipient_name" in data:
        quote.recipient_name = (data.get("recipient_name") or "").strip() or None
    if "site_address" in data:
        quote.site_address = (data.get("site_address") or "").strip() or None
    if "note" in data:
        quote.note = (data.get("note") or "").strip() or None

    if "items" in data:
        items, items_err = _normalize_items(data.get("items"))
        if items_err:
            return items_err
        quote.items.clear()
        db.session.flush()
        for item in items:
            db.session.add(QuoteItem(quote_id=quote.id, **item))
        _sync_quote_items_to_catalog(items)
        total_err = _apply_totals(quote, items, data.get("tax_rate", quote.tax_rate))
    elif "tax_rate" in data:
        items = [item.to_dict() for item in quote.items]
        total_err = _apply_totals(quote, items, data.get("tax_rate", quote.tax_rate))
    else:
        total_err = None

    if total_err:
        return total_err

    # Item-only edits may not otherwise issue an UPDATE for the quote row.
    quote.updated_at = datetime.utcnow()
    db.session.flush()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    if quote:
        _append_quote_version_snapshot(quote, action="update", summary="Quote updated")

    db.session.commit()
    quote = Quote.query.options(selectinload(Quote.items)).get(quote.id)
    return jsonify(quote.to_dict())


@crm_bp.post("/quotes/<int:quote_id>/duplicate")
@role_required(*WRITE_ROLES)
def duplicate_quote(quote_id: int):
    source = Quote.query.options(
        selectinload(Quote.items),
        selectinload(Quote.customer),
        selectinload(Quote.contact),
    ).get_or_404(quote_id)

    try:
        copied = _duplicate_quote(source)
    except ValueError:
        db.session.rollback()
        return jsonify({"msg": "無法複製此報價單，請檢查品項或稅率資料"}), 400

    db.session.commit()
    copied = Quote.query.options(selectinload(Quote.items)).get(copied.id)
    return jsonify(copied.to_dict() if copied else {}), 201


@crm_bp.delete("/quotes/<int:quote_id>")
@role_required(*WRITE_ROLES)
def delete_quote(quote_id: int):
    quote = Quote.query.options(
        selectinload(Quote.items),
        selectinload(Quote.customer),
        selectinload(Quote.contact),
        selectinload(Quote.invoices),
    ).get_or_404(quote_id)

    related_invoice = _active_invoice_for_quote(quote.id)
    if related_invoice is not None:
        return (
            jsonify(
                {
                    "msg": "此報價單已建立請款單，無法刪除",
                    "invoice_id": related_invoice.id,
                    "invoice_no": related_invoice.invoice_no,
                }
            ),
            400,
        )

    related_contract = Contract.query.filter(Contract.quote_id == quote.id).order_by(Contract.id.desc()).first()
    if related_contract is not None:
        return (
            jsonify(
                {
                    "msg": "此報價單已建立工程契約，為保留契約版本與稽核紀錄，無法刪除",
                    "contract_id": related_contract.id,
                    "contract_no": related_contract.contract_no,
                }
            ),
            409,
        )

    cancelled_invoices = Invoice.query.filter(
        Invoice.quote_id == quote.id,
        Invoice.status == "cancelled",
    ).all()
    for invoice in cancelled_invoices:
        invoice.quote_id = None

    quote_snapshot = quote.to_dict()
    customer = quote.customer
    contact = quote.contact
    quote_label = quote.quote_no
    db.session.delete(quote)
    _append_audit_log(
        action="quote_delete",
        entity_type="quote",
        entity_id=quote_id,
        entity_label=quote_label,
        details=quote_snapshot,
        note=f"Deleted quote {quote_label}",
    )
    db.session.commit()
    return jsonify(
        {
            "msg": "Quote deleted",
            "quote_id": quote_id,
            "quote_no": quote_label,
            "customer_name": customer.name if customer else None,
            "contact_name": contact.name if contact else None,
        }
    )


@crm_bp.get("/quotes/<int:quote_id>/versions")
@role_required(*READ_ROLES)
def quote_versions(quote_id: int):
    quote = Quote.query.get_or_404(quote_id)
    rows = (
        QuoteVersion.query.options(selectinload(QuoteVersion.changed_by))
        .filter(QuoteVersion.quote_id == quote.id)
        .order_by(QuoteVersion.version_no.desc(), QuoteVersion.id.desc())
        .all()
    )
    return jsonify(
        {
            "quote_id": quote.id,
            "quote_no": quote.quote_no,
            "versions": [row.to_dict() for row in rows],
        }
    )


@crm_bp.get("/contracts")
@role_required(*READ_ROLES)
def list_contracts():
    query = Contract.query.options(
        selectinload(Contract.quote),
        selectinload(Contract.created_by),
        selectinload(Contract.versions),
    ).order_by(Contract.updated_at.desc(), Contract.id.desc())
    quote_id = request.args.get("quote_id", type=int)
    if quote_id:
        query = query.filter(Contract.quote_id == quote_id)
    return jsonify([row.to_dict() for row in query.limit(200).all()])


@crm_bp.post("/quotes/<int:quote_id>/contracts")
@role_required(*WRITE_ROLES)
def create_contract(quote_id: int):
    quote = Quote.query.options(
        selectinload(Quote.items),
        selectinload(Quote.customer),
        selectinload(Quote.contact),
    ).get_or_404(quote_id)
    data = request.get_json() or {}
    customer = quote.customer
    contact = quote.contact
    contract_date, date_error = _parse_date(data.get("contract_date") or date.today(), "contract_date")
    if date_error:
        return date_error

    party_a_name = (
        str(data.get("party_a_name") or "").strip()
        or (quote.recipient_name or "").strip()
        or (customer.name if customer else "")
    )
    project_name = str(data.get("project_name") or "").strip() or f"{party_a_name or quote.quote_no} 水電工程"
    branding_name = SiteSetting.get_value("branding_name", "立翔水電行") or "立翔水電行"
    quote_version_no = _latest_quote_version_no(quote)
    contract = Contract(
        contract_no=_next_contract_no(contract_date),
        quote_id=quote.id,
        quote_version_no=quote_version_no,
        status="draft",
        contract_date=contract_date,
        project_name=project_name,
        site_address=(quote.site_address or (customer.address if customer else None)),
        party_a_name=party_a_name,
        party_a_tax_id=customer.tax_id if customer else None,
        party_a_phone=(contact.phone if contact and contact.phone else (customer.phone if customer else None)),
        party_a_address=customer.address if customer else None,
        party_b_name=branding_name,
        party_b_tax_id="14511159",
        party_b_phone=None,
        party_b_address=None,
        start_date=None,
        end_date=None,
        currency=(quote.currency or "TWD").upper(),
        total_amount=float(quote.total_amount or 0.0),
        payment_terms=DEFAULT_CONTRACT_PAYMENT_TERMS,
        warranty_months=DEFAULT_CONTRACT_WARRANTY_MONTHS,
        special_terms=None,
        quote_snapshot_json=_contract_quote_snapshot(quote, customer, contact),
        created_by_id=get_current_user_id(),
    )
    payload_error = _apply_contract_payload(contract, data)
    if payload_error:
        return payload_error
    if not contract.party_a_name:
        return jsonify({"msg": "party_a_name is required"}), 400

    db.session.add(contract)
    try:
        db.session.flush()
        _append_contract_version(contract, action="create", summary="Contract created from quote snapshot")
        _append_audit_log(
            action="contract_create",
            entity_type="contract",
            entity_id=contract.id,
            entity_label=contract.contract_no,
            details={"quote_id": quote.id, "quote_no": quote.quote_no, "quote_version_no": quote_version_no},
        )
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"msg": "契約編號建立衝突，請重新操作"}), 409
    return jsonify(contract.to_dict()), 201


@crm_bp.put("/contracts/<int:contract_id>")
@role_required(*WRITE_ROLES)
def update_contract(contract_id: int):
    contract = Contract.query.options(
        selectinload(Contract.quote),
        selectinload(Contract.versions),
    ).get_or_404(contract_id)
    if contract.status == "signed":
        return jsonify({"msg": "已簽署契約不可直接修改，請建立補充協議或新契約"}), 409
    before = contract.to_dict()
    data = request.get_json() or {}
    payload_error = _apply_contract_payload(contract, data)
    if payload_error:
        return payload_error
    contract.updated_at = datetime.utcnow()
    db.session.flush()
    _append_contract_version(
        contract,
        action="update",
        summary=str(data.get("version_summary") or "Contract updated")[:255],
    )
    _append_audit_log(
        action="contract_update",
        entity_type="contract",
        entity_id=contract.id,
        entity_label=contract.contract_no,
        details=_audit_field_changes(before, contract.to_dict()),
    )
    db.session.commit()
    return jsonify(contract.to_dict())


@crm_bp.get("/contracts/<int:contract_id>/versions")
@role_required(*READ_ROLES)
def contract_versions(contract_id: int):
    contract = Contract.query.get_or_404(contract_id)
    rows = (
        ContractVersion.query.options(selectinload(ContractVersion.changed_by))
        .filter(ContractVersion.contract_id == contract.id)
        .order_by(ContractVersion.version_no.desc(), ContractVersion.id.desc())
        .all()
    )
    return jsonify(
        {
            "contract_id": contract.id,
            "contract_no": contract.contract_no,
            "quote_id": contract.quote_id,
            "quote_version_no": contract.quote_version_no,
            "versions": [row.to_dict() for row in rows],
        }
    )


@crm_bp.get("/contracts/<int:contract_id>/pdf")
@role_required(*READ_ROLES)
def contract_pdf(contract_id: int):
    contract = Contract.query.options(selectinload(Contract.quote)).get_or_404(contract_id)
    try:
        buffer = _build_contract_pdf(contract)
    except RuntimeError as exc:
        return jsonify(
            {
                "msg": "契約 PDF 產生失敗",
                "detail": str(exc),
                "font_health": _pdf_font_health_payload(),
            }
        ), 500
    filename = f"{_safe_download_filename_part(contract.contract_no, fallback='contract')}_工程承攬契約.pdf"
    response = send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@crm_bp.post("/quotes/<int:quote_id>/convert-to-invoice")
@role_required(*WRITE_ROLES)
def convert_quote_to_invoice(quote_id: int):
    quote = Quote.query.options(
        selectinload(Quote.items),
        selectinload(Quote.customer),
        selectinload(Quote.contact),
    ).get_or_404(quote_id)

    existing = (
        _invoice_query_with_details()
        .filter(Invoice.quote_id == quote.id)
        .filter(Invoice.status != "cancelled")
        .order_by(Invoice.created_at.desc(), Invoice.id.desc())
        .first()
    )
    if existing is not None:
        return jsonify(
            {
                "msg": "Quote already converted to invoice",
                "created": False,
                "invoice": existing.to_dict(),
            }
        )

    items = []
    for idx, quote_item in enumerate(
        sorted(
            list(quote.items or []),
            key=lambda item: (
                item.sort_order if item.sort_order is not None else 10**9,
                item.id if item.id is not None else 10**9,
            ),
        )
    ):
        items.append(
            {
                "description": (quote_item.description or "").strip(),
                "unit": (quote_item.unit or "").strip() or "式",
                "quantity": float(quote_item.quantity or 0.0),
                "unit_price": float(quote_item.unit_price or 0.0),
                "amount": round(float(quote_item.amount or 0.0), 2),
                "sort_order": idx,
            }
        )

    if not items:
        return jsonify({"msg": "Quote has no items to convert"}), 400

    invoice = Invoice(
        invoice_no=_next_invoice_no(),
        status="issued",
        customer_id=quote.customer_id,
        contact_id=quote.contact_id,
        quote_id=quote.id,
        issue_date=quote.issue_date or date.today(),
        due_date=quote.expiry_date or quote.issue_date or date.today(),
        currency=(quote.currency or "TWD").strip().upper() or "TWD",
        note=(quote.note or "").strip() or None,
        created_by_id=get_current_user_id(),
    )

    total_err = _apply_totals(invoice, items, quote.tax_rate or 0)
    if total_err:
        return total_err

    db.session.add(invoice)
    db.session.flush()

    for item in items:
        db.session.add(InvoiceItem(invoice_id=invoice.id, **item))

    _append_audit_log(
        action="invoice_create_from_quote",
        entity_type="invoice",
        entity_id=invoice.id,
        entity_label=invoice.invoice_no,
        details={
            "invoice_no": invoice.invoice_no,
            "quote_id": quote.id,
            "quote_no": quote.quote_no,
            "customer_id": quote.customer_id,
            "customer_name": quote.customer.name if quote.customer else None,
            "item_count": len(items),
            "totals": {
                "subtotal": round(float(invoice.subtotal or 0.0), 2),
                "tax_rate": round(float(invoice.tax_rate or 0.0), 2),
                "tax_amount": round(float(invoice.tax_amount or 0.0), 2),
                "total_amount": round(float(invoice.total_amount or 0.0), 2),
            },
        },
        note="報價單轉請款單",
    )

    db.session.commit()
    invoice = _invoice_query_with_details().get(invoice.id)
    return (
        jsonify(
            {
                "msg": "Invoice created from quote",
                "created": True,
                "invoice": invoice.to_dict() if invoice else None,
            }
        ),
        201,
    )


@crm_bp.get("/invoices")
@role_required(*READ_ROLES)
def list_invoices():
    query = _invoice_query_with_details().order_by(Invoice.updated_at.desc(), Invoice.id.desc())

    customer_id = request.args.get("customer_id", type=int)
    quote_id = request.args.get("quote_id", type=int)
    raw_quote_ids = (request.args.get("quote_ids") or "").strip()
    status = (request.args.get("status") or "").strip().lower()
    limit = _normalize_limit_arg(request.args.get("limit"), default=5, maximum=200)

    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if quote_id:
        query = query.filter(Invoice.quote_id == quote_id)
    if raw_quote_ids:
        quote_ids = []
        for chunk in raw_quote_ids.split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            try:
                quote_ids.append(int(chunk))
            except ValueError:
                continue
        if quote_ids:
            query = query.filter(Invoice.quote_id.in_(quote_ids))
    if status:
        query = query.filter(Invoice.status == status)

    rows = query.limit(limit).all() if limit is not None else query.all()
    return jsonify([row.to_dict() for row in rows])


@crm_bp.post("/invoices")
@role_required(*WRITE_ROLES)
def create_invoice():
    return _invoice_module_disabled()


@crm_bp.put("/invoices/<int:invoice_id>")
@role_required(*WRITE_ROLES)
def update_invoice(invoice_id: int):
    invoice = _invoice_query_with_details().get_or_404(invoice_id)
    before_snapshot = {
        "status": (invoice.status or "").strip().lower() or None,
        "note": invoice.note,
        "paid_at": invoice.paid_at,
    }
    data = request.get_json() or {}

    if "status" in data:
        status = (data.get("status") or "").strip().lower()
        if status not in VALID_INVOICE_STATUS:
            return jsonify({"msg": "Invalid invoice status"}), 400
        invoice.status = status
        if status == "paid" and invoice.paid_at is None:
            invoice.paid_at = datetime.utcnow()
        elif status != "paid":
            invoice.paid_at = None

    if "note" in data:
        invoice.note = (data.get("note") or "").strip() or None

    after_snapshot = {
        "status": (invoice.status or "").strip().lower() or None,
        "note": invoice.note,
        "paid_at": invoice.paid_at,
    }
    changes = _audit_field_changes(before_snapshot, after_snapshot, fields=["status", "note", "paid_at"])
    if changes:
        status_to = (after_snapshot.get("status") or "").strip().lower()
        action = "invoice_update"
        if "status" in changes and set(changes.keys()) == {"status"}:
            action = "invoice_cancel" if status_to == "cancelled" else "invoice_status_update"
        elif "status" in changes and status_to == "cancelled":
            action = "invoice_cancel"
        _append_audit_log(
            action=action,
            entity_type="invoice",
            entity_id=invoice.id,
            entity_label=invoice.invoice_no,
            details={
                "invoice_no": invoice.invoice_no,
                "quote_no": invoice.quote.quote_no if invoice.quote else None,
                "changes": changes,
            },
            note="請款單更新",
        )

    db.session.commit()
    invoice = _invoice_query_with_details().get(invoice.id)
    return jsonify(invoice.to_dict() if invoice else {})


@crm_bp.post("/invoices/<int:invoice_id>/signature")
@role_required(*WRITE_ROLES)
def upload_invoice_signature(invoice_id: int):
    invoice = _invoice_query_with_details().get_or_404(invoice_id)
    data = request.get_json(silent=True) or {}
    data_url = (data.get("data_url") or "").strip()
    if not data_url:
        return jsonify({"msg": "Missing signature data"}), 400

    signature_name = (
        (
            data.get("signature_name")
            or data.get("customer_name")
            or (invoice.contact.name if invoice.contact else None)
            or (invoice.customer.name if invoice.customer else None)
            or ""
        ).strip()
    )
    try:
        invoice.customer_signature_path = replace_signature_file(
            existing_path=invoice.customer_signature_path,
            data_url=data_url,
        )
    except ValueError as exc:
        return jsonify({"msg": str(exc)}), 400
    except Exception as exc:
        current_app.logger.error("Invoice signature upload failed: %s", exc)
        return jsonify({"msg": "Signature upload failed"}), 500

    invoice.customer_signature_name = signature_name or None
    invoice.customer_signed_at = datetime.utcnow()
    _append_audit_log(
        action="invoice_signature_upload",
        entity_type="invoice",
        entity_id=invoice.id,
        entity_label=invoice.invoice_no,
        details={
            "invoice_no": invoice.invoice_no,
            "customer_signature_name": invoice.customer_signature_name,
            "customer_signed_at": invoice.customer_signed_at,
        },
        note="客戶簽名已更新",
    )
    db.session.commit()

    invoice = _invoice_query_with_details().get(invoice.id)
    return jsonify(invoice.to_dict() if invoice else {})


@crm_bp.post("/invoices/<int:invoice_id>/payments")
@role_required(*WRITE_ROLES)
def create_invoice_payment_record(invoice_id: int):
    invoice = _invoice_query_with_details().get_or_404(invoice_id)
    if (invoice.status or "").strip().lower() == "cancelled":
        return jsonify({"msg": "Cancelled invoices cannot receive payments"}), 400
    before_status = (invoice.status or "").strip().lower() or None
    before_payment_total = _invoice_payment_total(invoice)
    before_outstanding = round(max(float(invoice.total_amount or 0.0) - float(before_payment_total or 0.0), 0.0), 2)

    data = request.get_json() or {}
    payment_date, payment_date_err = _parse_date(data.get("payment_date"), "payment_date")
    if payment_date_err:
        return payment_date_err
    payment_date = payment_date or date.today()

    amount, amount_err = _parse_float(data.get("amount"), "amount", minimum=0)
    if amount_err:
        return amount_err
    if amount is None or float(amount) <= 0:
        return jsonify({"msg": "amount must be > 0"}), 400

    payment = InvoicePaymentRecord(
        invoice=invoice,
        payment_date=payment_date,
        amount=round(float(amount), 2),
        method=(data.get("method") or data.get("payment_method") or "").strip() or None,
        note=(data.get("note") or "").strip() or None,
        received_by_id=get_current_user_id(),
    )
    db.session.add(payment)
    db.session.flush()
    _recalculate_invoice_payment_status(invoice)
    after_status = (invoice.status or "").strip().lower() or None
    after_payment_total = _invoice_payment_total(invoice)
    after_outstanding = round(max(float(invoice.total_amount or 0.0) - float(after_payment_total or 0.0), 0.0), 2)
    _append_audit_log(
        action="invoice_payment_create",
        entity_type="invoice_payment",
        entity_id=payment.id,
        entity_label=invoice.invoice_no,
        details={
            "invoice_id": invoice.id,
            "invoice_no": invoice.invoice_no,
            "payment": {
                "id": payment.id,
                "payment_date": payment.payment_date,
                "amount": payment.amount,
                "method": payment.method,
                "note": payment.note,
            },
            "invoice_status": {"from": before_status, "to": after_status},
            "payment_total": {"from": before_payment_total, "to": after_payment_total},
            "outstanding_amount": {"from": before_outstanding, "to": after_outstanding},
        },
        note="新增收款紀錄",
    )
    db.session.commit()

    invoice = _invoice_query_with_details().get(invoice.id)
    return (
        jsonify(
            {
                "msg": "Invoice payment recorded",
                **(_invoice_payment_payload(invoice) if invoice else {"invoice": None, "payment_total": 0.0}),
            }
        ),
        201,
    )


@crm_bp.delete("/invoices/<int:invoice_id>/payments/<int:payment_id>")
@role_required(*WRITE_ROLES)
def delete_invoice_payment_record(invoice_id: int, payment_id: int):
    invoice = _invoice_query_with_details().get_or_404(invoice_id)
    payment = next((row for row in (invoice.payment_records or []) if int(row.id) == int(payment_id)), None)
    if payment is None:
        return jsonify({"msg": "Invoice payment record not found"}), 404
    before_status = (invoice.status or "").strip().lower() or None
    before_payment_total = _invoice_payment_total(invoice)
    before_outstanding = round(max(float(invoice.total_amount or 0.0) - float(before_payment_total or 0.0), 0.0), 2)
    payment_snapshot = payment.to_dict()

    db.session.delete(payment)
    db.session.flush()
    db.session.expire(invoice, ["payment_records"])
    _recalculate_invoice_payment_status(invoice)
    after_status = (invoice.status or "").strip().lower() or None
    after_payment_total = _invoice_payment_total(invoice)
    after_outstanding = round(max(float(invoice.total_amount or 0.0) - float(after_payment_total or 0.0), 0.0), 2)
    _append_audit_log(
        action="invoice_payment_delete",
        entity_type="invoice_payment",
        entity_id=payment_snapshot.get("id"),
        entity_label=invoice.invoice_no,
        details={
            "invoice_id": invoice.id,
            "invoice_no": invoice.invoice_no,
            "payment": payment_snapshot,
            "invoice_status": {"from": before_status, "to": after_status},
            "payment_total": {"from": before_payment_total, "to": after_payment_total},
            "outstanding_amount": {"from": before_outstanding, "to": after_outstanding},
        },
        note="刪除收款紀錄",
    )
    db.session.commit()

    invoice = _invoice_query_with_details().get(invoice.id)
    return jsonify(
        {
            "msg": "Invoice payment deleted",
            **(_invoice_payment_payload(invoice) if invoice else {"invoice": None, "payment_total": 0.0}),
        }
    )


@crm_bp.get("/quotes/<int:quote_id>/xlsx")
@role_required(*READ_ROLES)
def quote_xlsx(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    customer = Customer.query.get(quote.customer_id)
    contact = Contact.query.get(quote.contact_id) if quote.contact_id else None
    cache_key = _build_download_cache_key(
        "quote-xlsx-v3",
        quote.id,
        quote.updated_at,
        customer.updated_at if customer else None,
        contact.updated_at if contact else None,
        _line_items_cache_token(quote.items),
    )
    cached = _get_cached_download(cache_key)
    if cached is not None:
        content, cached_filename, cached_mimetype = cached
        return send_file(
            BytesIO(content),
            mimetype=cached_mimetype,
            as_attachment=True,
            download_name=cached_filename,
        )

    template_path = _find_quote_template_path()
    if template_path is None:
        return jsonify({"msg": "Quote template not found"}), 500

    try:
        workbook = load_workbook(template_path)
    except Exception:
        return jsonify({"msg": "Quote template cannot be opened"}), 500

    if not workbook.worksheets:
        return jsonify({"msg": "Quote template has no worksheet"}), 500

    sheet_name = (request.args.get("sheet") or "").strip()
    if sheet_name:
        worksheet = workbook[sheet_name] if sheet_name in workbook.sheetnames else None
        if worksheet is None:
            return jsonify({"msg": f"Template sheet not found: {sheet_name}"}), 400
    else:
        worksheet = workbook.worksheets[0]

    for existing_sheet in list(workbook.worksheets):
        if existing_sheet.title != worksheet.title:
            workbook.remove(existing_sheet)

    safe_title = (quote.quote_no or "估價單").strip()[:31] or "估價單"
    worksheet.title = safe_title
    _apply_quote_to_template_sheet(worksheet, quote, customer, contact)

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    customer_part = _safe_download_filename_part(customer.name if customer else None, fallback="客戶")
    quote_part = _safe_download_filename_part(quote.quote_no, fallback="估價單")
    filename = f"{customer_part}-{quote_part}.xlsx"
    content = output.getvalue()
    _store_cached_download(
        cache_key,
        content=content,
        filename=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    return send_file(
        BytesIO(content),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


def _build_contract_pdf(contract: Contract) -> BytesIO:
    font_name = _contract_pdf_font_name()
    try:
        snapshot = json.loads(contract.quote_snapshot_json or "{}")
    except json.JSONDecodeError:
        snapshot = {}
    quote_payload = snapshot.get("quote") if isinstance(snapshot, dict) else {}
    quote_payload = quote_payload if isinstance(quote_payload, dict) else {}
    quote_items = quote_payload.get("items") if isinstance(quote_payload.get("items"), list) else []

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=22 * mm,
        bottomMargin=19 * mm,
        title=f"工程承攬契約-{contract.contract_no}",
        author=contract.party_b_name,
        subject=f"{contract.project_name}工程承攬契約",
    )
    styles = getSampleStyleSheet()
    title_style = styles["Heading1"].clone("ContractTitle")
    title_style.fontName = font_name
    title_style.fontSize = 24
    title_style.leading = 32
    title_style.alignment = 1
    title_style.textColor = colors.black
    subtitle_style = title_style.clone("ContractSubtitle")
    subtitle_style.fontSize = 15
    subtitle_style.leading = 23
    body_style = styles["BodyText"].clone("ContractBody")
    body_style.fontName = font_name
    body_style.fontSize = 11.2
    body_style.leading = 19
    body_style.wordWrap = "CJK"
    body_style.textColor = colors.black
    body_style.firstLineIndent = 22.4
    body_style.alignment = 4
    clause_title_style = body_style.clone("ContractClauseTitle")
    clause_title_style.fontSize = 12.3
    clause_title_style.leading = 20
    clause_title_style.firstLineIndent = 0
    clause_title_style.alignment = 0
    clause_title_style.spaceBefore = 7
    clause_title_style.spaceAfter = 1
    clause_title_style.keepWithNext = True
    warning_style = body_style.clone("ContractWarning")
    warning_style.fontSize = 8.2
    warning_style.leading = 13
    warning_style.firstLineIndent = 0
    warning_style.alignment = 0
    warning_style.textColor = colors.HexColor("#444444")
    small_style = body_style.clone("ContractSmall")
    small_style.fontSize = 8.6
    small_style.leading = 13
    small_style.firstLineIndent = 0
    small_style.alignment = 0
    label_style = body_style.clone("ContractLabel")
    label_style.fontSize = 10.2
    label_style.leading = 15
    label_style.firstLineIndent = 0
    label_style.alignment = 0
    center_style = label_style.clone("ContractCenter")
    center_style.alignment = 1

    def paragraph(value, style=body_style):
        return Paragraph(escape(str(value or "")).replace("\n", "<br />"), style)

    def roc_date_text(value: date | None) -> str:
        if not value:
            return "中華民國　　　年　　　月　　　日"
        return f"中華民國 {value.year - 1911} 年 {value.month} 月 {value.day} 日"

    def formal_table(rows, widths, *, header_rows=0, align_right_from=None):
        table = Table(rows, colWidths=widths, repeatRows=header_rows)
        commands = [
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("GRID", (0, 0), (-1, -1), 0.55, colors.HexColor("#555555")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        if header_rows:
            commands.extend(
                [
                    ("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#eeeeee")),
                    ("ALIGN", (0, 0), (-1, header_rows - 1), "CENTER"),
                ]
            )
        if align_right_from is not None:
            commands.append(("ALIGN", (align_right_from, header_rows), (-1, -1), "RIGHT"))
        table.setStyle(TableStyle(commands))
        return table

    cover_party_table = Table(
        [
            [paragraph("甲方（定作人）", label_style), paragraph(contract.party_a_name, label_style)],
            [paragraph("乙方（承攬人）", label_style), paragraph(contract.party_b_name, label_style)],
        ],
        colWidths=[42 * mm, 114 * mm],
    )
    cover_party_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("LINEBELOW", (0, 0), (-1, -1), 0.7, colors.HexColor("#666666")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )

    contract_date_text = roc_date_text(contract.contract_date)
    start_text = roc_date_text(contract.start_date) if contract.start_date else "雙方另行書面確認"
    end_text = roc_date_text(contract.end_date) if contract.end_date else "雙方另行書面確認"
    amount_text = f"新臺幣 {_format_amount_number(float(contract.total_amount or 0))} 元整"
    special_terms = contract.special_terms or "無；如有追加減工程，應另以書面確認。"
    clauses = [
        ("第一條　契約文件及工程範圍", f"本契約、附件一工程估價明細（估價單號：{quote_payload.get('quote_no') or '-'}；版本：{contract.quote_version_no}）及雙方書面確認之追加減工程單，均為本契約之一部分。乙方應依附件所列品項、規格、數量及施工地點完成工作。"),
        ("第二條　契約價金", f"本契約總價為 {amount_text}（幣別：{contract.currency}）。材料由乙方供給者，其價額已包含於附件所列報酬；未列項目須另行報價並經雙方書面同意。"),
        ("第三條　付款方式", contract.payment_terms),
        ("第四條　施工期間", f"預定開工日：{start_text}；預定完工日：{end_text}。因甲方需求變更、現場條件、天候、不可抗力或非可歸責於乙方之事由影響工期時，雙方應書面調整工期。"),
        ("第五條　追加減工程", "任何品項、數量、材料、施工方式或價金之變更，應先以追加減工程單、電子訊息或其他可保存之書面方式確認；未經確認者，任一方不得逕自認定已包含於原契約。"),
        ("第六條　驗收與瑕疵處理", "工程完成後由雙方辦理驗收。甲方發現瑕疵時，應具體通知乙方並給予合理修補期間；乙方應於合理期間內處理。雙方對瑕疵或改善方式有爭議時，應先保存照片、紀錄及相關證據。"),
        ("第七條　保固", f"自驗收完成日起保固 {int(contract.warranty_months or 0)} 個月。保固不包含正常耗損、甲方或第三人不當使用、未經乙方同意之改裝、天然災害或其他不可歸責於乙方之原因。個別設備之原廠保固依原廠條件辦理。"),
        ("第八條　雙方配合事項", "甲方應提供合法、安全且可施工之場所、必要之進場權限及水電使用條件；乙方應依專業方式施工並遵守必要之安全規範。涉及申請、停電、停水或第三方配合者，雙方應事先協調。"),
        ("第九條　停工、終止與結算", "任一方因重大事由需停工或終止契約時，應以可保存之方式通知他方。雙方應依已完成工作、已進場材料、必要費用及可歸責事由辦理結算；有爭議時先行協商。"),
        ("第十條　爭議處理", "本契約依中華民國法律處理。發生爭議時，雙方應先本於誠信協商；協商不成時，依法律所定之管轄法院或雙方另行合法約定之程序處理。"),
        ("第十一條　特別約定", special_terms),
        ("第十二條　契約份數", "本契約及附件由雙方各執一份為憑；電子檔與經雙方確認之紙本具有相同內容時，均應妥善保存。"),
    ]

    snapshot_digest = hashlib.sha256((contract.quote_snapshot_json or "").encode("utf-8")).hexdigest()[:16].upper()
    review_box = formal_table(
        [
            [paragraph("契約審閱確認", label_style), paragraph("本契約於中華民國　　　年　　　月　　　日交付甲方攜回審閱。", label_style)],
            [paragraph("甲方簽章", label_style), paragraph("　　　　　　　　　　　　　　　　", label_style)],
        ],
        [35 * mm, 121 * mm],
    )
    cover_meta = formal_table(
        [
            [paragraph("契約編號", label_style), paragraph(contract.contract_no, label_style), paragraph("契約日期", label_style), paragraph(contract_date_text, label_style)],
            [paragraph("估價單號", label_style), paragraph(quote_payload.get("quote_no") or "-", label_style), paragraph("綁定版本", label_style), paragraph(f"第 {contract.quote_version_no} 版", label_style)],
        ],
        [27 * mm, 51 * mm, 27 * mm, 51 * mm],
    )
    story = [
        review_box,
        Spacer(1, 18 * mm),
        Paragraph("水電工程承攬契約書", title_style),
        Spacer(1, 8 * mm),
        Paragraph(escape(contract.project_name), subtitle_style),
        Spacer(1, 20 * mm),
        cover_party_table,
        Spacer(1, 13 * mm),
        cover_meta,
        Spacer(1, 18 * mm),
        paragraph("本契約本文、估價明細附件及雙方後續書面確認文件，應合併保存。", center_style),
        Spacer(1, 7 * mm),
        paragraph("範本提示：正式使用前，應由具台灣法律資格之律師依實際交易對象、工程性質與付款條件完成審閱。", warning_style),
        PageBreak(),
        Paragraph("水電工程承攬契約書", subtitle_style),
        Spacer(1, 4 * mm),
        paragraph(f"立契約書人：甲方（定作人）{contract.party_a_name}；乙方（承攬人）{contract.party_b_name}。雙方就下列工程承攬事項達成合意，共同遵守本契約各條款。"),
        Spacer(1, 5 * mm),
    ]

    party_rows = [
        [paragraph("當事人", label_style), paragraph("名稱", label_style), paragraph("統編／識別", label_style), paragraph("電話", label_style)],
        [paragraph("甲方（定作人）", label_style), paragraph(contract.party_a_name, label_style), paragraph(contract.party_a_tax_id or "＿＿＿＿＿＿", label_style), paragraph(contract.party_a_phone or "＿＿＿＿＿＿", label_style)],
        [paragraph("乙方（承攬人）", label_style), paragraph(contract.party_b_name, label_style), paragraph(contract.party_b_tax_id or "＿＿＿＿＿＿", label_style), paragraph(contract.party_b_phone or "＿＿＿＿＿＿", label_style)],
        [paragraph("甲方地址", label_style), paragraph(contract.party_a_address or "＿＿＿＿＿＿＿＿＿＿＿＿", label_style), "", ""],
        [paragraph("乙方地址", label_style), paragraph(contract.party_b_address or "＿＿＿＿＿＿＿＿＿＿＿＿", label_style), "", ""],
    ]
    party_table = formal_table(party_rows, [31 * mm, 55 * mm, 35 * mm, 35 * mm], header_rows=1)
    party_table.setStyle(TableStyle([("SPAN", (1, 3), (3, 3)), ("SPAN", (1, 4), (3, 4))]))
    summary_rows = [
        [paragraph("工程名稱", label_style), paragraph(contract.project_name, label_style)],
        [paragraph("施工地點", label_style), paragraph(contract.site_address or "________________", label_style)],
        [paragraph("契約總價", label_style), paragraph(amount_text, label_style)],
        [paragraph("施工期間", label_style), paragraph(f"{start_text} 起至 {end_text} 止", label_style)],
        [paragraph("付款方式", label_style), paragraph(contract.payment_terms, label_style)],
        [paragraph("保固期間", label_style), paragraph(f"驗收完成日起 {int(contract.warranty_months or 0)} 個月", label_style)],
    ]
    summary_table = formal_table(summary_rows, [31 * mm, 125 * mm])
    story.extend([party_table, Spacer(1, 5 * mm), summary_table, Spacer(1, 5 * mm)])
    for heading, content in clauses:
        story.append(Paragraph(escape(heading), clause_title_style))
        story.append(paragraph(content))

    story.extend([PageBreak(), Paragraph("立契約書人", subtitle_style), Spacer(1, 8 * mm)])
    signature_table = Table(
        [
            [paragraph("甲方（定作人）", label_style), paragraph("乙方（承攬人）", label_style)],
            [paragraph(f"姓名／名稱：{contract.party_a_name}", label_style), paragraph(f"名稱：{contract.party_b_name}", label_style)],
            [paragraph("代表人：____________________________", label_style), paragraph("代表人：____________________________", label_style)],
            [paragraph(f"統編／身分識別：{contract.party_a_tax_id or '________________'}", label_style), paragraph(f"統一編號：{contract.party_b_tax_id or '________________'}", label_style)],
            [paragraph(f"地址：{contract.party_a_address or '________________'}", label_style), paragraph(f"地址：{contract.party_b_address or '________________'}", label_style)],
            [paragraph(f"電話：{contract.party_a_phone or '________________'}", label_style), paragraph(f"電話：{contract.party_b_phone or '________________'}", label_style)],
            [paragraph("簽章處", center_style), paragraph("簽章處", center_style)],
            [Spacer(1, 30 * mm), Spacer(1, 30 * mm)],
        ],
        colWidths=[78 * mm, 78 * mm],
    )
    signature_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#555555")),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#888888")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            signature_table,
            Spacer(1, 10 * mm),
            paragraph(f"簽約日期：{contract_date_text}", center_style),
            PageBreak(),
            Paragraph("附件一　工程估價明細", subtitle_style),
            Spacer(1, 3 * mm),
            paragraph(f"來源估價單：{quote_payload.get('quote_no') or '-'}　｜　綁定版本：第 {contract.quote_version_no} 版　｜　快照識別碼：{snapshot_digest}", small_style),
            paragraph("本附件內容於契約建立時凍結；後續修改估價單不會改變本附件。", small_style),
            Spacer(1, 4 * mm),
        ]
    )
    item_rows = [[paragraph("項次", small_style), paragraph("品項／規格", small_style), paragraph("單位", small_style), paragraph("數量", small_style), paragraph("單價", small_style), paragraph("金額", small_style)]]
    for index, item in enumerate(quote_items, start=1):
        if not isinstance(item, dict):
            continue
        description = str(item.get("description") or "")
        note = str(item.get("note") or "").strip()
        if note:
            description = f"{description}\n{note}"
        item_rows.append(
            [
                paragraph(index, small_style),
                paragraph(description, small_style),
                paragraph(item.get("unit") or "", small_style),
                paragraph(_format_amount_number(float(item.get("quantity") or 0)), small_style),
                paragraph(_format_amount_number(float(item.get("unit_price") or 0)), small_style),
                paragraph(_format_amount_number(float(item.get("amount") or 0)), small_style),
            ]
        )
    item_rows.append(["", paragraph("契約總價", small_style), "", "", "", paragraph(_format_amount_number(float(contract.total_amount or 0)), small_style)])
    item_table = Table(item_rows, colWidths=[11 * mm, 70 * mm, 15 * mm, 18 * mm, 25 * mm, 27 * mm], repeatRows=1)
    item_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#555555")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f3f3f3")),
                ("SPAN", (1, -1), (4, -1)),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([item_table, Spacer(1, 4 * mm), paragraph("附件完", center_style)])

    company_name = contract.party_b_name or "承攬人"

    class ContractNumberedCanvas(pdf_canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._saved_page_states = []

        def showPage(self):
            self._saved_page_states.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            page_count = len(self._saved_page_states)
            for state in self._saved_page_states:
                self.__dict__.update(state)
                page_number = int(self._pageNumber)
                self.saveState()
                self.setStrokeColor(colors.HexColor("#777777"))
                self.setLineWidth(0.35)
                if page_number > 1:
                    self.setFont(font_name, 8)
                    self.setFillColor(colors.HexColor("#444444"))
                    self.drawString(18 * mm, A4[1] - 12 * mm, f"{company_name}　水電工程承攬契約書")
                    self.drawRightString(A4[0] - 18 * mm, A4[1] - 12 * mm, f"契約編號：{contract.contract_no}")
                    self.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)
                self.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
                self.setFont(font_name, 7.8)
                self.setFillColor(colors.HexColor("#555555"))
                self.drawString(18 * mm, 9.5 * mm, "本契約應連同附件一併保存")
                self.drawRightString(A4[0] - 18 * mm, 9.5 * mm, f"第 {page_number} 頁，共 {page_count} 頁")
                self.restoreState()
                pdf_canvas.Canvas.showPage(self)
            pdf_canvas.Canvas.save(self)

    doc.build(story, canvasmaker=ContractNumberedCanvas)
    buffer.seek(0)
    return buffer


@crm_bp.get("/quotes/<int:quote_id>/pdf")
@role_required(*READ_ROLES)
def quote_pdf(quote_id: int):
    quote = Quote.query.options(selectinload(Quote.items)).get_or_404(quote_id)
    customer = Customer.query.get(quote.customer_id)
    contact = Contact.query.get(quote.contact_id) if quote.contact_id else None
    cache_key = _build_download_cache_key(
        "quote-pdf-v7",
        quote.id,
        quote.updated_at,
        customer.updated_at if customer else None,
        contact.updated_at if contact else None,
        _line_items_cache_token(quote.items),
    )
    cached = _get_cached_download(cache_key)
    if cached is not None:
        content, cached_filename, cached_mimetype = cached
        response = send_file(
            BytesIO(content),
            mimetype=cached_mimetype,
            as_attachment=True,
            download_name=cached_filename,
        )
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    try:
        buffer = _build_quote_template_pdf(quote, customer, contact)
    except RuntimeError as exc:
        return jsonify(
            {
                "msg": "PDF 字型未就緒：目前未使用可嵌入的繁中字型，已停止輸出以避免手機/部分電腦顯示異常。",
                "detail": str(exc),
                "font_health": _pdf_font_health_payload(),
            }
        ), 500
    customer_raw = (quote.recipient_name or "").strip() or (customer.name if customer else None) or (contact.name if contact else None)
    customer_part = _safe_download_filename_part(customer_raw, fallback="客戶")
    if quote.issue_date:
        date_compact = quote.issue_date.strftime("%Y%m%d")
    elif getattr(quote, "created_at", None):
        date_compact = quote.created_at.strftime("%Y%m%d")
    else:
        date_compact = datetime.utcnow().strftime("%Y%m%d")
    date_part = _safe_download_filename_part(date_compact, fallback="date")
    filename = f"{customer_part}_{date_part}.pdf"
    content = buffer.getvalue()
    _store_cached_download(
        cache_key,
        content=content,
        filename=filename,
        mimetype="application/pdf",
    )
    response = send_file(
        BytesIO(content),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@crm_bp.get("/health/pdf-font")
@role_required(*READ_ROLES)
def crm_pdf_font_health():
    return jsonify(_pdf_font_health_payload())


@crm_bp.get("/health/db")
@role_required(*READ_ROLES)
def crm_db_health():
    engine = db.engine
    url = engine.url
    return jsonify(
        {
            "dialect": engine.dialect.name,
            "driver": engine.dialect.driver,
            "database": url.database,
            "host": url.host,
            "port": url.port,
        }
    )


@crm_bp.get("/invoices/<int:invoice_id>/pdf")
@role_required(*READ_ROLES)
def invoice_pdf(invoice_id: int):
    invoice = Invoice.query.options(selectinload(Invoice.items)).get_or_404(invoice_id)
    customer = Customer.query.get(invoice.customer_id)
    contact = Contact.query.get(invoice.contact_id) if invoice.contact_id else None
    cache_key = _build_download_cache_key(
        "invoice-pdf-v3",
        invoice.id,
        invoice.updated_at,
        customer.updated_at if customer else None,
        contact.updated_at if contact else None,
        _line_items_cache_token(invoice.items),
    )
    cached = _get_cached_download(cache_key)
    if cached is not None:
        content, cached_filename, cached_mimetype = cached
        return send_file(
            BytesIO(content),
            mimetype=cached_mimetype,
            as_attachment=False,
            download_name=cached_filename,
        )

    try:
        buffer = _build_invoice_template_pdf(invoice, customer, contact)
    except RuntimeError as exc:
        return jsonify(
            {
                "msg": "請款單 PDF 產生失敗",
                "detail": str(exc),
                "font_health": _pdf_font_health_payload(),
            }
        ), 500

    customer_raw = (customer.name if customer else None) or (contact.name if contact else None)
    customer_part = _safe_download_filename_part(customer_raw, fallback="customer")
    if invoice.issue_date:
        date_compact = invoice.issue_date.strftime("%Y%m%d")
    elif getattr(invoice, "created_at", None):
        date_compact = invoice.created_at.strftime("%Y%m%d")
    else:
        date_compact = datetime.utcnow().strftime("%Y%m%d")
    date_part = _safe_download_filename_part(date_compact, fallback="date")
    filename = f"{customer_part}_{date_part}_請款單.pdf"
    content = buffer.getvalue()
    _store_cached_download(
        cache_key,
        content=content,
        filename=filename,
        mimetype="application/pdf",
    )
    return send_file(
        BytesIO(content),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@crm_bp.get("/boot")
@role_required(*READ_ROLES)
def crm_bootstrap():
    customers = Customer.query.order_by(Customer.updated_at.desc()).limit(50).all()
    contacts = Contact.query.order_by(Contact.updated_at.desc()).limit(100).all()
    quotes = Quote.query.options(selectinload(Quote.items)).order_by(Quote.updated_at.desc()).limit(30).all()
    catalog_items = (
        ServiceCatalogItem.query.filter(ServiceCatalogItem.is_active.is_(True))
        .order_by(ServiceCatalogItem.updated_at.desc())
        .limit(200)
        .all()
    )

    return jsonify(
        {
            "customers": [row.to_dict() for row in customers],
            "contacts": [row.to_dict() for row in contacts],
            "quotes": [row.to_dict() for row in quotes],
            "invoices": [],
            "catalog_items": [row.to_dict() for row in catalog_items],
        }
    )


