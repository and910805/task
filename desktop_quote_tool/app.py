from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import tkinter as tk
import tkinter.font as tkfont
from datetime import date, timedelta
from pathlib import Path
from tkinter import messagebox, ttk
from typing import Any
from urllib.parse import urljoin

import requests
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

LOCAL_PDF_STAMP_ENV = "PDF_STAMP_IMAGE_PATH"
LOCAL_PDF_STAMP_FILENAME = "S__5505135-removebg-preview.png"
LOCAL_PDF_STAMP_ROTATE_ENV = "PDF_STAMP_ROTATE_DEG"
LOCAL_PDF_STAMP_DEFAULT_ROTATE_DEG = 90.0
LOCAL_PDF_STAMP_WIDTH_MM = 24.0
LOCAL_PDF_STAMP_Y_OFFSET_ENV = "PDF_STAMP_Y_OFFSET_MM"
LOCAL_PDF_STAMP_DEFAULT_Y_OFFSET_MM = 4.0
FINANCIAL_DIGITS = ("零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖")
FINANCIAL_SMALL_UNITS = ("", "拾", "佰", "仟")
FINANCIAL_BIG_UNITS = ("", "萬", "億", "兆")


class APIError(Exception):
    pass


class TaskGoAPI:
    def __init__(self) -> None:
        self.base_url = "https://task.kuanlin.pro"
        self.token = ""

    def set_base_url(self, base_url: str) -> None:
        cleaned = (base_url or "").strip().rstrip("/")
        if not cleaned:
            raise APIError("系統網址不能為空")
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            raise APIError("系統網址必須以 http:// 或 https:// 開頭")
        self.base_url = cleaned

    def _request(self, method: str, path: str, *, auth_required: bool = True, **kwargs: Any) -> requests.Response:
        headers = kwargs.pop("headers", {}) or {}
        if auth_required:
            if not self.token:
                raise APIError("請先登入")
            headers["Authorization"] = f"Bearer {self.token}"
        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        try:
            resp = requests.request(method, url, headers=headers, timeout=25, **kwargs)
        except requests.RequestException as exc:
            raise APIError(f"連線失敗: {exc}") from exc
        if resp.ok:
            return resp
        try:
            msg = (resp.json() or {}).get("msg") or f"HTTP {resp.status_code}"
        except Exception:
            msg = f"HTTP {resp.status_code}"
        raise APIError(str(msg))

    def login(self, username: str, password: str) -> None:
        payload = self._request(
            "POST",
            "/api/auth/login",
            auth_required=False,
            json={"username": username, "password": password},
        ).json()
        token = payload.get("token")
        if not token:
            raise APIError("登入成功但沒有收到 token")
        self.token = token

    def get_customers(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/crm/customers").json()
        return data if isinstance(data, list) else []

    def get_contacts(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/crm/contacts").json()
        return data if isinstance(data, list) else []

    def get_catalog_items(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/crm/catalog-items").json()
        return data if isinstance(data, list) else []

    def get_quotes(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/crm/quotes").json()
        return data if isinstance(data, list) else []

    def create_quote(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._request("POST", "/api/crm/quotes", json=payload).json()
        return data if isinstance(data, dict) else {}

    def download_quote_pdf(self, quote_id: int) -> bytes:
        return self._request("GET", f"/api/crm/quotes/{quote_id}/pdf").content

    def download_quote_xlsx(self, quote_id: int) -> bytes:
        return self._request("GET", f"/api/crm/quotes/{quote_id}/xlsx").content


class DesktopQuoteTool:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("TaskGo 會計報價工具")
        self.root.geometry("1280x820")
        self.root.minsize(1100, 720)

        self.api = TaskGoAPI()
        self.customers: list[dict[str, Any]] = []
        self.contacts: list[dict[str, Any]] = []
        self.catalog_items: list[dict[str, Any]] = []
        self.quotes: list[dict[str, Any]] = []
        self.current_items: list[dict[str, Any]] = []
        self.local_pdf_font = "Helvetica"

        self.customer_map: dict[str, int] = {}
        self.contact_map: dict[str, int] = {}
        self.catalog_map: dict[str, dict[str, Any]] = {}
        self.quote_map: dict[str, dict[str, Any]] = {}
        self.item_row_map: dict[str, int] = {}
        self.editing_item_index: int | None = None

        self.base_url_var = tk.StringVar(value="https://task.kuanlin.pro")
        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()
        self.status_var = tk.StringVar(value="尚未登入")

        self.customer_var = tk.StringVar()
        self.contact_var = tk.StringVar()
        self.issue_date_var = tk.StringVar(value=date.today().isoformat())
        self.expiry_date_var = tk.StringVar(value=(date.today() + timedelta(days=10)).isoformat())
        self.currency_var = tk.StringVar(value="TWD")
        self.note_var = tk.StringVar()

        self.catalog_pick_var = tk.StringVar()
        self.item_desc_var = tk.StringVar()
        self.item_unit_var = tk.StringVar(value="式")
        self.item_qty_var = tk.StringVar(value="1")
        self.item_price_var = tk.StringVar(value="0")
        self.total_var = tk.StringVar(value="0.00")

        self._build_ui()

    def _build_ui(self) -> None:
        self.root.option_add("*Font", (self._pick_font(), 10))
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        top = ttk.LabelFrame(self.root, text="系統連線", padding=8)
        top.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 6))
        for col in range(10):
            top.columnconfigure(col, weight=1 if col in (1, 3, 5, 9) else 0)
        ttk.Label(top, text="網址").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.base_url_var).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Label(top, text="帳號").grid(row=0, column=2, sticky="w")
        ttk.Entry(top, textvariable=self.username_var).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Label(top, text="密碼").grid(row=0, column=4, sticky="w")
        ttk.Entry(top, textvariable=self.password_var, show="*").grid(row=0, column=5, sticky="ew", padx=4)
        ttk.Button(top, text="登入", command=self.login).grid(row=0, column=6, padx=4)
        ttk.Button(top, text="載入主檔", command=self.load_master).grid(row=0, column=7, padx=4)
        ttk.Button(top, text="刷新報價", command=self.refresh_quotes).grid(row=0, column=8, padx=4)
        ttk.Label(top, textvariable=self.status_var).grid(row=0, column=9, sticky="e")

        notebook = ttk.Notebook(self.root)
        notebook.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self.query_tab = ttk.Frame(notebook, padding=10)
        self.create_tab = ttk.Frame(notebook, padding=10)
        notebook.add(self.query_tab, text="報價查詢")
        notebook.add(self.create_tab, text="建立估價單")
        self._build_query_tab()
        self._build_create_tab()

    @staticmethod
    def _pick_font() -> str:
        candidates = ["Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans CJK TC", "Arial"]
        try:
            installed = set(tkfont.families())
        except tk.TclError:
            installed = set()
        for c in candidates:
            if c in installed:
                return c
        return "TkDefaultFont"

    def _build_query_tab(self) -> None:
        self.query_tab.columnconfigure(0, weight=1)
        self.query_tab.rowconfigure(1, weight=1)

        actions = ttk.Frame(self.query_tab)
        actions.grid(row=0, column=0, sticky="ew")
        ttk.Button(actions, text="重新整理", command=self.refresh_quotes).grid(row=0, column=0, padx=4)
        ttk.Button(actions, text="PDF（地端繁中）", command=self.open_local_pdf).grid(row=0, column=1, padx=4)
        ttk.Button(actions, text="PDF（系統）", command=self.open_server_pdf).grid(row=0, column=2, padx=4)
        ttk.Button(actions, text="XLSX", command=self.open_xlsx).grid(row=0, column=3, padx=4)

        paned = ttk.Panedwindow(self.query_tab, orient="vertical")
        paned.grid(row=1, column=0, sticky="nsew", pady=(8, 0))

        list_frame = ttk.LabelFrame(paned, text="報價列表", padding=6)
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)
        cols = ("quote_no", "status", "amount", "customer", "issue_date")
        self.quote_tree = ttk.Treeview(list_frame, columns=cols, show="headings", height=15)
        for c, t, w, a in [
            ("quote_no", "單號", 320, "w"),
            ("status", "狀態", 100, "center"),
            ("amount", "金額", 130, "e"),
            ("customer", "客戶", 240, "w"),
            ("issue_date", "日期", 140, "center"),
        ]:
            self.quote_tree.heading(c, text=t)
            self.quote_tree.column(c, width=w, anchor=a)
        self.quote_tree.grid(row=0, column=0, sticky="nsew")
        ttk.Scrollbar(list_frame, orient="vertical", command=self.quote_tree.yview).grid(row=0, column=1, sticky="ns")
        self.quote_tree.bind("<<TreeviewSelect>>", self.show_quote_detail)

        detail = ttk.LabelFrame(paned, text="明細", padding=6)
        detail.columnconfigure(0, weight=1)
        detail.rowconfigure(0, weight=1)
        self.detail_text = tk.Text(detail, wrap="word", height=10)
        self.detail_text.grid(row=0, column=0, sticky="nsew")
        self.detail_text.insert("1.0", "請在上方選擇一筆報價。")
        self.detail_text.configure(state="disabled")

        paned.add(list_frame, weight=3)
        paned.add(detail, weight=2)

    def _build_create_tab(self) -> None:
        self.create_tab.columnconfigure(0, weight=1)
        self.create_tab.rowconfigure(1, weight=1)

        base = ttk.LabelFrame(self.create_tab, text="基本資料", padding=8)
        base.grid(row=0, column=0, sticky="ew")
        for col in range(4):
            base.columnconfigure(col, weight=1 if col in (1, 3) else 0)
        ttk.Label(base, text="客戶").grid(row=0, column=0, sticky="w")
        self.customer_combo = ttk.Combobox(base, textvariable=self.customer_var, state="readonly")
        self.customer_combo.grid(row=0, column=1, sticky="ew", padx=4, pady=2)
        self.customer_combo.bind("<<ComboboxSelected>>", self.on_customer_changed)
        ttk.Label(base, text="聯絡人").grid(row=0, column=2, sticky="w")
        self.contact_combo = ttk.Combobox(base, textvariable=self.contact_var, state="readonly")
        self.contact_combo.grid(row=0, column=3, sticky="ew", padx=4, pady=2)
        ttk.Label(base, text="報價日期").grid(row=1, column=0, sticky="w")
        ttk.Entry(base, textvariable=self.issue_date_var).grid(row=1, column=1, sticky="ew", padx=4, pady=2)
        ttk.Label(base, text="有效日期").grid(row=1, column=2, sticky="w")
        ttk.Entry(base, textvariable=self.expiry_date_var).grid(row=1, column=3, sticky="ew", padx=4, pady=2)
        ttk.Label(base, text="幣別").grid(row=2, column=0, sticky="w")
        ttk.Entry(base, textvariable=self.currency_var).grid(row=2, column=1, sticky="ew", padx=4, pady=2)
        ttk.Label(base, text="稅率").grid(row=2, column=2, sticky="w")
        ttk.Label(base, text="固定 0%（未稅）").grid(row=2, column=3, sticky="w", padx=4)
        ttk.Label(base, text="備註").grid(row=3, column=0, sticky="w")
        ttk.Entry(base, textvariable=self.note_var).grid(row=3, column=1, columnspan=3, sticky="ew", padx=4, pady=2)

        items = ttk.LabelFrame(self.create_tab, text="品項", padding=8)
        items.grid(row=1, column=0, sticky="nsew", pady=(8, 0))
        items.columnconfigure(0, weight=1)
        items.rowconfigure(1, weight=1)

        source = ttk.Frame(items)
        source.grid(row=0, column=0, sticky="ew")
        source.columnconfigure(1, weight=1)
        ttk.Label(source, text="價目表").grid(row=0, column=0, sticky="w")
        self.catalog_combo = ttk.Combobox(source, textvariable=self.catalog_pick_var, state="readonly")
        self.catalog_combo.grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(source, text="帶入", command=self.add_from_catalog).grid(row=0, column=2, padx=4)
        ttk.Entry(source, textvariable=self.item_desc_var).grid(row=1, column=1, sticky="ew", padx=4, pady=4)
        ttk.Entry(source, textvariable=self.item_unit_var, width=8).grid(row=1, column=2, padx=2, pady=4)
        ttk.Entry(source, textvariable=self.item_qty_var, width=8).grid(row=1, column=3, padx=2, pady=4)
        ttk.Entry(source, textvariable=self.item_price_var, width=10).grid(row=1, column=4, padx=2, pady=4)
        ttk.Button(source, text="手動新增", command=self.add_manual_item).grid(row=1, column=5, padx=4, pady=4)
        ttk.Button(source, text="載入選取", command=self.load_selected_item_for_edit).grid(row=1, column=6, padx=4, pady=4)
        ttk.Button(source, text="更新選取", command=self.update_selected_item).grid(row=1, column=7, padx=4, pady=4)
        ttk.Label(source, text="品名").grid(row=2, column=1, sticky="w", padx=4)
        ttk.Label(source, text="單位").grid(row=2, column=2, sticky="w", padx=2)
        ttk.Label(source, text="數量").grid(row=2, column=3, sticky="w", padx=2)
        ttk.Label(source, text="單價").grid(row=2, column=4, sticky="w", padx=2)

        table = ttk.Frame(items)
        table.grid(row=1, column=0, sticky="nsew")
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        cols = ("desc", "unit", "qty", "price", "amount")
        self.item_tree = ttk.Treeview(table, columns=cols, show="headings", height=12)
        for c, t, w, a in [
            ("desc", "品名", 430, "w"),
            ("unit", "單位", 90, "center"),
            ("qty", "數量", 120, "e"),
            ("price", "單價", 150, "e"),
            ("amount", "小計", 150, "e"),
        ]:
            self.item_tree.heading(c, text=t)
            self.item_tree.column(c, width=w, anchor=a)
        self.item_tree.grid(row=0, column=0, sticky="nsew")
        ttk.Scrollbar(table, orient="vertical", command=self.item_tree.yview).grid(row=0, column=1, sticky="ns")
        self.item_tree.bind("<Double-1>", lambda _event: self.load_selected_item_for_edit())

        bottom = ttk.Frame(items)
        bottom.grid(row=2, column=0, sticky="ew", pady=(8, 0))
        bottom.columnconfigure(6, weight=1)
        ttk.Button(bottom, text="上移", command=lambda: self.move_selected_item(-1)).grid(row=0, column=0, padx=4)
        ttk.Button(bottom, text="下移", command=lambda: self.move_selected_item(1)).grid(row=0, column=1, padx=4)
        ttk.Button(bottom, text="刪除選取", command=self.remove_selected_item).grid(row=0, column=2, padx=4)
        ttk.Button(bottom, text="清空全部", command=self.clear_items).grid(row=0, column=3, padx=4)
        ttk.Label(bottom, text="未稅合計").grid(row=0, column=4, padx=(18, 4))
        ttk.Label(bottom, textvariable=self.total_var).grid(row=0, column=5, padx=4)
        ttk.Button(bottom, text="建立估價單", command=self.create_quote).grid(row=0, column=7, padx=4)

    def _require_login(self) -> bool:
        if self.api.token:
            return True
        messagebox.showerror("尚未登入", "請先登入系統。")
        return False

    def login(self) -> None:
        if not self.username_var.get().strip() or not self.password_var.get().strip():
            messagebox.showerror("資料不完整", "請輸入帳號與密碼。")
            return
        try:
            self.api.set_base_url(self.base_url_var.get())
            self.api.login(self.username_var.get().strip(), self.password_var.get().strip())
            self.status_var.set("登入成功")
            self.load_master()
            self.refresh_quotes()
        except APIError as exc:
            self.status_var.set(f"登入失敗: {exc}")
            messagebox.showerror("登入失敗", str(exc))

    def load_master(self) -> None:
        if not self._require_login():
            return
        try:
            self.customers = self.api.get_customers()
            self.contacts = self.api.get_contacts()
            self.catalog_items = self.api.get_catalog_items()
        except APIError as exc:
            self.status_var.set(f"載入失敗: {exc}")
            messagebox.showerror("載入失敗", str(exc))
            return
        self._populate_customers()
        self._populate_catalog()
        self.on_customer_changed(None)
        self.status_var.set(f"主檔完成 客戶{len(self.customers)} 價目{len(self.catalog_items)}")

    def _populate_customers(self) -> None:
        self.customer_map.clear()
        vals = []
        for c in self.customers:
            cid = c.get("id")
            if cid is None:
                continue
            label = f"{cid} - {c.get('name', '')}"
            vals.append(label)
            self.customer_map[label] = int(cid)
        self.customer_combo["values"] = vals
        if vals and self.customer_var.get() not in vals:
            self.customer_var.set(vals[0])

    def _populate_catalog(self) -> None:
        self.catalog_map.clear()
        vals = []
        for item in self.catalog_items:
            iid = item.get("id")
            if iid is None:
                continue
            unit = item.get("unit") or "式"
            price = float(item.get("unit_price") or 0)
            label = f"{iid} - {item.get('name', '')}（{unit} / {price:.0f}）"
            vals.append(label)
            self.catalog_map[label] = item
        self.catalog_combo["values"] = vals
        if vals and self.catalog_pick_var.get() not in vals:
            self.catalog_pick_var.set(vals[0])

    def on_customer_changed(self, _event: Any) -> None:
        cid = self.customer_map.get(self.customer_var.get())
        vals = [""]
        self.contact_map.clear()
        for c in self.contacts:
            if cid and int(c.get("customer_id") or 0) == cid:
                label = f"{c.get('id')} - {c.get('name', '')}"
                vals.append(label)
                self.contact_map[label] = int(c.get("id") or 0)
        self.contact_combo["values"] = vals
        if self.contact_var.get() not in vals:
            self.contact_var.set("")

    def _customer_name(self, customer_id: Any) -> str:
        for c in self.customers:
            if str(c.get("id")) == str(customer_id):
                return str(c.get("name") or customer_id)
        return str(customer_id or "")

    def refresh_quotes(self) -> None:
        if not self._require_login():
            return
        try:
            self.quotes = self.api.get_quotes()
        except APIError as exc:
            self.status_var.set(f"報價讀取失敗: {exc}")
            messagebox.showerror("讀取失敗", str(exc))
            return
        for rid in self.quote_tree.get_children():
            self.quote_tree.delete(rid)
        self.quote_map.clear()
        for q in self.quotes:
            qid = q.get("id")
            if qid is None:
                continue
            amount = float(q.get("subtotal") if q.get("subtotal") is not None else q.get("total_amount") or 0)
            row = self.quote_tree.insert(
                "",
                "end",
                values=(q.get("quote_no", ""), q.get("status", ""), f"{amount:.2f}", self._customer_name(q.get("customer_id")), q.get("issue_date") or ""),
            )
            self.quote_map[row] = q
        self.status_var.set(f"報價共 {len(self.quotes)} 筆")

    def _selected_quote(self) -> dict[str, Any] | None:
        sel = self.quote_tree.selection()
        if not sel:
            messagebox.showerror("未選取", "請先選一筆報價。")
            return None
        return self.quote_map.get(sel[0])

    def show_quote_detail(self, _event: Any) -> None:
        q = self._selected_quote()
        if not q:
            return
        lines = [
            f"單號: {q.get('quote_no', '')}",
            f"狀態: {q.get('status', '')}",
            f"客戶: {self._customer_name(q.get('customer_id'))}",
            f"日期: {q.get('issue_date') or '-'}",
            f"有效: {q.get('expiry_date') or '-'}",
            f"幣別: {q.get('currency') or 'TWD'}",
            f"未稅金額: {float(q.get('subtotal') or 0):.2f}",
            "",
            "品項:",
        ]
        for idx, item in enumerate(q.get("items") or [], start=1):
            lines.append(f"{idx}. {item.get('description','')} | {item.get('unit','')} | {float(item.get('quantity') or 0):.2f} x {float(item.get('unit_price') or 0):.2f}")
        self.detail_text.configure(state="normal")
        self.detail_text.delete("1.0", tk.END)
        self.detail_text.insert("1.0", "\n".join(lines))
        self.detail_text.configure(state="disabled")

    def _ensure_local_font(self) -> None:
        if self.local_pdf_font != "Helvetica":
            return
        candidates = []
        if os.name == "nt":
            win = os.environ.get("WINDIR", r"C:\Windows")
            candidates += [os.path.join(win, "Fonts", "msjh.ttc"), os.path.join(win, "Fonts", "mingliu.ttc")]
        for path in candidates:
            if not os.path.exists(path):
                continue
            for idx in (0, 1, 2, 3):
                try:
                    pdfmetrics.registerFont(TTFont("LocalCJK", path, subfontIndex=idx))
                    self.local_pdf_font = "LocalCJK"
                    return
                except Exception:
                    continue
        for cid in ("MSung-Light", "STSong-Light"):
            try:
                pdfmetrics.registerFont(UnicodeCIDFont(cid))
                self.local_pdf_font = cid
                return
            except Exception:
                continue

    @staticmethod
    def _resolve_local_stamp_path() -> str | None:
        configured = (os.environ.get(LOCAL_PDF_STAMP_ENV) or "").strip()
        if configured and os.path.exists(configured):
            return configured

        default_path = Path(__file__).resolve().parents[1] / "data" / LOCAL_PDF_STAMP_FILENAME
        if default_path.exists() and default_path.is_file():
            return str(default_path)
        return None

    @staticmethod
    def _resolve_local_stamp_rotate_deg() -> float:
        raw = (os.environ.get(LOCAL_PDF_STAMP_ROTATE_ENV) or "").strip()
        if not raw:
            return LOCAL_PDF_STAMP_DEFAULT_ROTATE_DEG
        try:
            return float(raw)
        except ValueError:
            return LOCAL_PDF_STAMP_DEFAULT_ROTATE_DEG

    @staticmethod
    def _resolve_local_stamp_y_offset_mm() -> float:
        raw = (os.environ.get(LOCAL_PDF_STAMP_Y_OFFSET_ENV) or "").strip()
        if not raw:
            return LOCAL_PDF_STAMP_DEFAULT_Y_OFFSET_MM
        try:
            value = float(raw)
            return max(-20.0, min(20.0, value))
        except ValueError:
            return LOCAL_PDF_STAMP_DEFAULT_Y_OFFSET_MM

    @staticmethod
    def _flowable_render_height(flowable, avail_width: float, avail_height: float) -> float:
        width = max(avail_width, 1.0)
        height = max(avail_height, 1.0)
        _, wrapped_h = flowable.wrap(width, height)
        before = float(flowable.getSpaceBefore()) if hasattr(flowable, "getSpaceBefore") else 0.0
        after = float(flowable.getSpaceAfter()) if hasattr(flowable, "getSpaceAfter") else 0.0
        return float(wrapped_h) + before + after

    @classmethod
    def _estimate_table_cell_center(
        cls,
        doc,
        flowables_before,
        table,
        row_index: int,
        col_index: int,
        h_align: str = "LEFT",
    ) -> tuple[float, float] | None:
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
                block_h = cls._flowable_render_height(flowable, float(doc.width), remaining_height)
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
            row_center_y = row_top - row_heights[row_index] / 2.0
            col_left = table_left + sum(col_widths[:col_index])
            col_center_x = col_left + col_widths[col_index] / 2.0
            return col_center_x, row_center_y
        except Exception:
            return None

    @staticmethod
    def _format_amount_number(amount: float) -> str:
        safe_amount = round(float(amount or 0), 2)
        if safe_amount.is_integer():
            return f"{safe_amount:,.0f}"
        return f"{safe_amount:,.2f}"

    @staticmethod
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

    @classmethod
    def _financial_integer_to_text(cls, value: int) -> str:
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
            result.append(cls._financial_group_to_text(group_value))
            big_unit = FINANCIAL_BIG_UNITS[idx] if idx < len(FINANCIAL_BIG_UNITS) else ""
            if big_unit:
                result.append(big_unit)

        return "".join(result) if result else FINANCIAL_DIGITS[0]

    @classmethod
    def _format_financial_amount_text(cls, amount: float) -> str:
        rounded = round(float(amount or 0), 2)
        integer_amount = int(round(rounded))
        return f"{cls._financial_integer_to_text(integer_amount)}元整"

    def _build_local_pdf(self, q: dict[str, Any]) -> bytes:
        self._ensure_local_font()
        font = self.local_pdf_font
        stamp_path = self._resolve_local_stamp_path()
        quote_no = str(q.get("quote_no") or "")
        customer = self._customer_name(q.get("customer_id"))
        recipient = str(q.get("recipient_name") or customer or "")
        issue = str(q.get("issue_date") or date.today().isoformat())
        rows = [["項次", "項目名稱", "規格內容", "單位", "數量", "單價", "金額", "備註"]]
        items = q.get("items") or []
        for i in range(20):
            item = items[i] if i < len(items) else None
            if not item:
                rows.append([str(i + 1), "", "", "", "", "", "", ""])
            else:
                rows.append(
                    [
                        str(i + 1),
                        str(item.get("description") or ""),
                        "",
                        str(item.get("unit") or "式"),
                        f"{float(item.get('quantity') or 0):.2f}",
                        f"{float(item.get('unit_price') or 0):.2f}",
                        f"{float(item.get('amount') or 0):.2f}",
                        "",
                    ]
                )
        total = float(q.get("subtotal") if q.get("subtotal") is not None else q.get("total_amount") or 0)
        total_numeric = self._format_amount_number(total)
        total_upper = self._format_financial_amount_text(total)
        rows.append(["合計", "", "新台幣", total_upper, "", "NT$", total_numeric, ""])

        temp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf", prefix="taskgo-local-quote-").name
        doc = SimpleDocTemplate(temp, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm)
        styles = getSampleStyleSheet()
        title = styles["Heading1"].clone("t")
        title.fontName = font
        title.alignment = 1
        title.fontSize = 22
        title.leading = 28
        title.textColor = colors.HexColor("#111827")
        body = styles["Normal"].clone("b")
        body.fontName = font
        body.textColor = colors.HexColor("#1f2937")
        signer = styles["Normal"].clone("signer")
        signer.fontName = font
        signer.alignment = 2
        signer.fontSize = 12
        signer.leading = 16
        story = [Paragraph("立翔水電工程行", title), Paragraph("估價單", body), Spacer(1, 3 * mm), Paragraph(f"{recipient} 台照", body), Paragraph(f"日期：{issue}", body), Paragraph(f"單號：{quote_no}", body), Spacer(1, 4 * mm)]
        table = Table(rows, colWidths=[12 * mm, 46 * mm, 28 * mm, 14 * mm, 14 * mm, 20 * mm, 20 * mm, 20 * mm], repeatRows=1, hAlign="CENTER")
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (-1, -1), font),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
                    ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#9ca3af")),
                    ("ALIGN", (0, 0), (0, -1), "CENTER"),
                    ("ALIGN", (6, 0), (6, -1), "RIGHT"),
                    ("BACKGROUND", (6, 1), (6, -1), colors.HexColor("#fff3a3")),
                    ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#eef2ff")),
                    ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.HexColor("#4b5563")),
                    ("SPAN", (3, -1), (4, -1)),
                    ("ALIGN", (3, -1), (4, -1), "LEFT"),
                    ("FONTSIZE", (3, -1), (4, -1), 11),
                    ("FONTSIZE", (6, -1), (6, -1), 11),
                ]
            )
        )
        totals_row_index = len(rows) - 1 if rows else 0
        stamp_center = self._estimate_table_cell_center(
            doc,
            story,
            table,
            row_index=totals_row_index,
            col_index=6,
            h_align="LEFT",
        )
        story.append(table)
        story.extend([Spacer(1, 4 * mm), Paragraph("經手人：莊全立", signer)])

        def draw_stamp(target_canvas, doc_ref):
            if not stamp_path:
                return
            try:
                image = ImageReader(stamp_path)
                src_w, src_h = image.getSize()
                if not src_w or not src_h:
                    return
                stamp_w = LOCAL_PDF_STAMP_WIDTH_MM * mm
                stamp_h = stamp_w * float(src_h) / float(src_w)
                rotate_deg = self._resolve_local_stamp_rotate_deg()
                y_offset = self._resolve_local_stamp_y_offset_mm() * mm
                if stamp_center is not None:
                    center_x, center_y = stamp_center
                else:
                    page_w, page_h = doc_ref.pagesize
                    center_x = page_w - doc_ref.rightMargin - (stamp_w / 2.0)
                    center_y = page_h - doc_ref.topMargin - (stamp_h / 2.0) + 4 * mm
                center_y += y_offset
                page_w, page_h = doc_ref.pagesize
                min_x = float(doc_ref.leftMargin) + (stamp_w / 2.0)
                max_x = float(page_w) - float(doc_ref.rightMargin) - (stamp_w / 2.0)
                min_y = float(doc_ref.bottomMargin) + (stamp_h / 2.0)
                max_y = float(page_h) - float(doc_ref.topMargin) - (stamp_h / 2.0)
                center_x = max(min_x, min(max_x, float(center_x)))
                center_y = max(min_y, min(max_y, float(center_y)))
                target_canvas.saveState()
                target_canvas.translate(center_x, center_y)
                target_canvas.rotate(rotate_deg)
                target_canvas.drawImage(
                    image,
                    -stamp_w / 2.0,
                    -stamp_h / 2.0,
                    width=stamp_w,
                    height=stamp_h,
                    preserveAspectRatio=True,
                    mask="auto",
                )
                target_canvas.restoreState()
            except Exception:
                return

        class StampCanvas(pdf_canvas.Canvas):
            def showPage(self):
                draw_stamp(self, doc)
                super().showPage()

        doc.build(story, canvasmaker=StampCanvas)
        with open(temp, "rb") as f:
            content = f.read()
        os.unlink(temp)
        return content

    def open_local_pdf(self) -> None:
        q = self._selected_quote()
        if not q:
            return
        data = self._build_local_pdf(q)
        path = self._save_temp(data, ".pdf", "quote-local-")
        self._open_file(path)

    def open_server_pdf(self) -> None:
        q = self._selected_quote()
        if not q:
            return
        qid = int(q.get("id") or 0)
        if qid <= 0:
            return
        try:
            data = self.api.download_quote_pdf(qid)
            path = self._save_temp(data, ".pdf", "quote-server-")
            self._open_file(path)
        except APIError as exc:
            messagebox.showerror("PDF 錯誤", str(exc))

    def open_xlsx(self) -> None:
        q = self._selected_quote()
        if not q:
            return
        qid = int(q.get("id") or 0)
        if qid <= 0:
            return
        try:
            data = self.api.download_quote_xlsx(qid)
            path = self._save_temp(data, ".xlsx", "quote-")
            self._open_file(path)
        except APIError as exc:
            messagebox.showerror("XLSX 錯誤", str(exc))

    def add_from_catalog(self) -> None:
        item = self.catalog_map.get(self.catalog_pick_var.get())
        if not item:
            messagebox.showerror("未選擇", "請先選擇價目。")
            return
        self.current_items.append(
            {
                "description": str(item.get("name") or "").strip(),
                "unit": str(item.get("unit") or "式").strip() or "式",
                "quantity": 1.0,
                "unit_price": float(item.get("unit_price") or 0),
            }
        )
        self._refresh_items()

    def add_manual_item(self) -> None:
        item = self._collect_item_from_input()
        if item is None:
            return
        self.current_items.append(item)
        self._reset_item_input()
        self._refresh_items()

    def _collect_item_from_input(self) -> dict[str, Any] | None:
        desc = self.item_desc_var.get().strip()
        if not desc:
            messagebox.showerror("資料不完整", "請輸入品名。")
            return None
        try:
            qty = float((self.item_qty_var.get() or "0").strip())
            price = float((self.item_price_var.get() or "0").strip())
        except ValueError:
            messagebox.showerror("格式錯誤", "數量、單價需為數字。")
            return None
        if qty < 0 or price < 0:
            messagebox.showerror("格式錯誤", "數量、單價不可小於 0。")
            return None
        return {
            "description": desc,
            "unit": (self.item_unit_var.get() or "式").strip() or "式",
            "quantity": qty,
            "unit_price": price,
        }

    def _reset_item_input(self) -> None:
        self.item_desc_var.set("")
        self.item_unit_var.set("式")
        self.item_qty_var.set("1")
        self.item_price_var.set("0")

    def _selected_item_index(self, *, show_error: bool = True) -> int | None:
        selected = self.item_tree.selection()
        if not selected:
            if show_error:
                messagebox.showerror("未選取", "請先選擇品項。")
            return None
        row_id = selected[0]
        if row_id not in self.item_row_map:
            if show_error:
                messagebox.showerror("資料錯誤", "找不到選取的品項索引。")
            return None
        return self.item_row_map[row_id]

    def load_selected_item_for_edit(self) -> None:
        idx = self._selected_item_index()
        if idx is None or idx < 0 or idx >= len(self.current_items):
            return
        item = self.current_items[idx]
        self.item_desc_var.set(str(item.get("description") or ""))
        self.item_unit_var.set(str(item.get("unit") or "式"))
        self.item_qty_var.set(str(item.get("quantity") or 0))
        self.item_price_var.set(str(item.get("unit_price") or 0))
        self.editing_item_index = idx
        self.status_var.set(f"已載入第 {idx + 1} 筆，修改後按「更新選取」")

    def update_selected_item(self) -> None:
        idx = self.editing_item_index
        if idx is None:
            idx = self._selected_item_index()
        if idx is None or idx < 0 or idx >= len(self.current_items):
            return
        item = self._collect_item_from_input()
        if item is None:
            return
        self.current_items[idx] = item
        self.editing_item_index = None
        self._reset_item_input()
        self._refresh_items()
        self.status_var.set(f"已更新第 {idx + 1} 筆品項")

    def move_selected_item(self, direction: int) -> None:
        if direction not in (-1, 1):
            return
        idx = self._selected_item_index()
        if idx is None:
            return
        target = idx + direction
        if target < 0 or target >= len(self.current_items):
            return
        self.current_items[idx], self.current_items[target] = self.current_items[target], self.current_items[idx]
        self._refresh_items(select_index=target)
        self.status_var.set(f"已調整品項順序：第 {idx + 1} 筆 -> 第 {target + 1} 筆")

    def remove_selected_item(self) -> None:
        sel = self.item_tree.selection()
        if not sel:
            messagebox.showerror("未選取", "請先選擇品項。")
            return
        idxs = sorted((self.item_row_map[s] for s in sel if s in self.item_row_map), reverse=True)
        for idx in idxs:
            if 0 <= idx < len(self.current_items):
                self.current_items.pop(idx)
        self.editing_item_index = None
        self._refresh_items()

    def clear_items(self) -> None:
        self.current_items.clear()
        self.editing_item_index = None
        self._refresh_items()

    def _refresh_items(self, *, select_index: int | None = None) -> None:
        for rid in self.item_tree.get_children():
            self.item_tree.delete(rid)
        self.item_row_map.clear()
        total = 0.0
        selected_row_id = None
        for idx, item in enumerate(self.current_items):
            qty = float(item["quantity"])
            price = float(item["unit_price"])
            amount = qty * price
            total += amount
            row = self.item_tree.insert("", "end", values=(item["description"], item["unit"], f"{qty:.2f}", f"{price:.2f}", f"{amount:.2f}"))
            self.item_row_map[row] = idx
            if select_index is not None and idx == select_index:
                selected_row_id = row
        if selected_row_id is not None:
            self.item_tree.selection_set(selected_row_id)
            self.item_tree.focus(selected_row_id)
        self.total_var.set(f"{total:.2f}")

    def create_quote(self) -> None:
        if not self._require_login():
            return
        customer_id = self.customer_map.get(self.customer_var.get())
        if not customer_id:
            messagebox.showerror("資料不完整", "請選擇客戶。")
            return
        if not self.current_items:
            messagebox.showerror("資料不完整", "請至少加入一筆品項。")
            return
        issue = self.issue_date_var.get().strip()
        expiry = self.expiry_date_var.get().strip()
        for label, value in (("報價日期", issue), ("有效日期", expiry)):
            if value:
                try:
                    date.fromisoformat(value)
                except ValueError:
                    messagebox.showerror("日期格式錯誤", f"{label}需為 YYYY-MM-DD")
                    return
        payload = {
            "customer_id": customer_id,
            "contact_id": self.contact_map.get(self.contact_var.get()) or None,
            "recipient_name": (self.contact_var.get().strip() or self.customer_var.get().strip() or None),
            "issue_date": issue or None,
            "expiry_date": expiry or None,
            "currency": (self.currency_var.get() or "TWD").strip().upper(),
            "tax_rate": 0,
            "note": self.note_var.get().strip(),
            "items": [
                {"description": i["description"], "unit": i["unit"], "quantity": float(i["quantity"]), "unit_price": float(i["unit_price"])}
                for i in self.current_items
            ],
        }
        try:
            created = self.api.create_quote(payload)
        except APIError as exc:
            messagebox.showerror("建立失敗", str(exc))
            return
        messagebox.showinfo("建立成功", f"已建立：{created.get('quote_no', '(無單號)')}")
        self.current_items.clear()
        self.editing_item_index = None
        self._reset_item_input()
        self.note_var.set("")
        self.issue_date_var.set(date.today().isoformat())
        self.expiry_date_var.set((date.today() + timedelta(days=10)).isoformat())
        self._refresh_items()
        self.refresh_quotes()

    @staticmethod
    def _save_temp(content: bytes, suffix: str, prefix: str) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix) as f:
            f.write(content)
            return f.name

    @staticmethod
    def _open_file(path: str) -> None:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", path], check=False)
        else:
            subprocess.run(["xdg-open", path], check=False)


def main() -> None:
    root = tk.Tk()
    DesktopQuoteTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
