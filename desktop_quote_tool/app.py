from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import tkinter as tk
import tkinter.font as tkfont
from datetime import date
from tkinter import messagebox, ttk
from typing import Any
from urllib.parse import urljoin

import requests


class APIError(Exception):
    pass


class TaskGoAPI:
    def __init__(self) -> None:
        self.base_url = "https://task.kuanlin.pro"
        self.token = ""
        self.user: dict[str, Any] | None = None

    def set_base_url(self, base_url: str) -> None:
        cleaned = (base_url or "").strip().rstrip("/")
        if not cleaned:
            raise APIError("系統網址不能為空")
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            raise APIError("系統網址必須以 http:// 或 https:// 開頭")
        self.base_url = cleaned

    def _request(
        self,
        method: str,
        path: str,
        *,
        auth_required: bool = True,
        timeout: int = 25,
        **kwargs: Any,
    ) -> requests.Response:
        headers = kwargs.pop("headers", {}) or {}
        if auth_required:
            if not self.token:
                raise APIError("請先登入")
            headers["Authorization"] = f"Bearer {self.token}"

        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        try:
            response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
        except requests.RequestException as exc:
            raise APIError(f"連線失敗: {exc}") from exc

        if response.ok:
            return response

        error_message = f"HTTP {response.status_code}"
        try:
            payload = response.json()
            if isinstance(payload, dict) and payload.get("msg"):
                error_message = str(payload["msg"])
        except ValueError:
            pass
        raise APIError(error_message)

    def login(self, username: str, password: str) -> dict[str, Any]:
        response = self._request(
            "POST",
            "/api/auth/login",
            auth_required=False,
            json={"username": username, "password": password},
        )
        payload = response.json()
        token = payload.get("token")
        if not token:
            raise APIError("登入成功但沒有收到 token")
        self.token = token
        self.user = payload.get("user")
        return payload

    def get_customers(self) -> list[dict[str, Any]]:
        response = self._request("GET", "/api/crm/customers")
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def get_contacts(self) -> list[dict[str, Any]]:
        response = self._request("GET", "/api/crm/contacts")
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def get_quotes(self) -> list[dict[str, Any]]:
        response = self._request("GET", "/api/crm/quotes")
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def create_quote(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._request("POST", "/api/crm/quotes", json=payload)
        result = response.json()
        return result if isinstance(result, dict) else {}

    def download_quote_pdf(self, quote_id: int) -> bytes:
        response = self._request("GET", f"/api/crm/quotes/{quote_id}/pdf")
        return response.content

    def download_quote_xlsx(self, quote_id: int) -> bytes:
        response = self._request("GET", f"/api/crm/quotes/{quote_id}/xlsx")
        return response.content


class DesktopQuoteTool:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("TaskGo 會計報價工具")
        self.root.geometry("1240x840")
        self.root.minsize(1100, 720)

        self.api = TaskGoAPI()
        self.customers: list[dict[str, Any]] = []
        self.contacts: list[dict[str, Any]] = []
        self.quotes: list[dict[str, Any]] = []
        self.quote_row_to_data: dict[str, dict[str, Any]] = {}

        self.base_url_var = tk.StringVar(value="https://task.kuanlin.pro")
        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()
        self.status_var = tk.StringVar(value="尚未登入")

        self.customer_var = tk.StringVar()
        self.contact_var = tk.StringVar()
        self.issue_date_var = tk.StringVar(value=date.today().isoformat())
        self.expiry_date_var = tk.StringVar()
        self.currency_var = tk.StringVar(value="TWD")
        self.tax_rate_var = tk.StringVar(value="0")

        self.customer_label_to_id: dict[str, int] = {}
        self.contact_label_to_id: dict[str, int] = {}

        self._apply_style()
        self._build_ui()

    def _apply_style(self) -> None:
        family = self._pick_font_family(
            [
                "Microsoft JhengHei UI",
                "Microsoft JhengHei",
                "Noto Sans CJK TC",
                "PingFang TC",
                "Arial",
            ]
        )
        self.root.option_add("*Font", (family, 10))

        style = ttk.Style(self.root)
        if "vista" in style.theme_names():
            style.theme_use("vista")

        style.configure("Title.TLabel", font=(family, 14, "bold"))
        style.configure("Section.TLabelframe", padding=8)
        style.configure("Section.TLabelframe.Label", font=(family, 11, "bold"))
        style.configure("StatusOk.TLabel", foreground="#1f6f43")
        style.configure("StatusError.TLabel", foreground="#b42318")

    @staticmethod
    def _pick_font_family(candidates: list[str]) -> str:
        try:
            installed = set(tkfont.families())
        except tk.TclError:
            installed = set()
        for item in candidates:
            if item in installed:
                return item
        return "TkDefaultFont"

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        main = ttk.Frame(self.root, padding=12)
        main.grid(row=0, column=0, sticky="nsew")
        main.columnconfigure(0, weight=1)
        main.rowconfigure(1, weight=1)

        title = ttk.Label(main, text="TaskGo 會計報價工具", style="Title.TLabel")
        title.grid(row=0, column=0, sticky="w", pady=(0, 10))

        content = ttk.Frame(main)
        content.grid(row=1, column=0, sticky="nsew")
        content.columnconfigure(0, weight=1)
        content.rowconfigure(1, weight=1)

        self._build_login_card(content)

        notebook = ttk.Notebook(content)
        notebook.grid(row=1, column=0, sticky="nsew", pady=(8, 0))

        self.query_tab = ttk.Frame(notebook, padding=10)
        self.create_tab = ttk.Frame(notebook, padding=10)
        notebook.add(self.query_tab, text="報價單查詢")
        notebook.add(self.create_tab, text="建立報價單")

        self._build_query_tab()
        self._build_create_tab()

    def _build_login_card(self, parent: ttk.Frame) -> None:
        card = ttk.LabelFrame(parent, text="系統連線", style="Section.TLabelframe")
        card.grid(row=0, column=0, sticky="ew")
        for i in range(10):
            card.columnconfigure(i, weight=1 if i in (1, 3, 5, 9) else 0)

        ttk.Label(card, text="系統網址").grid(row=0, column=0, sticky="w", padx=(4, 2), pady=6)
        ttk.Entry(card, textvariable=self.base_url_var).grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(card, text="帳號").grid(row=0, column=2, sticky="w", padx=(10, 2), pady=6)
        ttk.Entry(card, textvariable=self.username_var).grid(row=0, column=3, sticky="ew", padx=4)

        ttk.Label(card, text="密碼").grid(row=0, column=4, sticky="w", padx=(10, 2), pady=6)
        ttk.Entry(card, textvariable=self.password_var, show="*").grid(row=0, column=5, sticky="ew", padx=4)

        ttk.Button(card, text="登入", command=self.login).grid(row=0, column=6, padx=4)
        ttk.Button(card, text="載入客戶資料", command=self.load_reference_data).grid(row=0, column=7, padx=4)
        ttk.Button(card, text="刷新報價列表", command=self.refresh_quotes).grid(row=0, column=8, padx=4)

        self.status_label = ttk.Label(card, textvariable=self.status_var, style="StatusOk.TLabel")
        self.status_label.grid(row=0, column=9, sticky="e", padx=(8, 4))

    def _build_query_tab(self) -> None:
        self.query_tab.columnconfigure(0, weight=1)
        self.query_tab.rowconfigure(1, weight=1)

        actions = ttk.Frame(self.query_tab)
        actions.grid(row=0, column=0, sticky="ew")

        ttk.Button(actions, text="重新整理", command=self.refresh_quotes).grid(row=0, column=0, padx=(0, 6), pady=(0, 8))
        ttk.Button(actions, text="開啟 PDF", command=self.open_selected_pdf).grid(row=0, column=1, padx=6, pady=(0, 8))
        ttk.Button(actions, text="開啟 XLSX", command=self.open_selected_xlsx).grid(row=0, column=2, padx=6, pady=(0, 8))

        paned = ttk.Panedwindow(self.query_tab, orient="vertical")
        paned.grid(row=1, column=0, sticky="nsew")

        table_frame = ttk.LabelFrame(paned, text="報價單列表", style="Section.TLabelframe")
        table_frame.columnconfigure(0, weight=1)
        table_frame.rowconfigure(0, weight=1)

        columns = ("quote_no", "status", "amount", "customer_id", "issue_date")
        self.quote_tree = ttk.Treeview(table_frame, columns=columns, show="headings", height=16)
        self.quote_tree.heading("quote_no", text="單號")
        self.quote_tree.heading("status", text="狀態")
        self.quote_tree.heading("amount", text="金額")
        self.quote_tree.heading("customer_id", text="客戶 ID")
        self.quote_tree.heading("issue_date", text="報價日期")

        self.quote_tree.column("quote_no", width=310, anchor="w")
        self.quote_tree.column("status", width=120, anchor="center")
        self.quote_tree.column("amount", width=140, anchor="e")
        self.quote_tree.column("customer_id", width=120, anchor="center")
        self.quote_tree.column("issue_date", width=160, anchor="center")

        y_scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.quote_tree.yview)
        x_scroll = ttk.Scrollbar(table_frame, orient="horizontal", command=self.quote_tree.xview)
        self.quote_tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        self.quote_tree.grid(row=0, column=0, sticky="nsew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll.grid(row=1, column=0, sticky="ew")
        self.quote_tree.bind("<<TreeviewSelect>>", self.on_quote_selected)

        detail_frame = ttk.LabelFrame(paned, text="報價明細", style="Section.TLabelframe")
        detail_frame.columnconfigure(0, weight=1)
        detail_frame.rowconfigure(0, weight=1)

        self.detail_text = tk.Text(detail_frame, height=12, wrap="word")
        detail_scroll = ttk.Scrollbar(detail_frame, orient="vertical", command=self.detail_text.yview)
        self.detail_text.configure(yscrollcommand=detail_scroll.set)
        self.detail_text.grid(row=0, column=0, sticky="nsew")
        detail_scroll.grid(row=0, column=1, sticky="ns")
        self.detail_text.insert("1.0", "請先從上方列表選擇一筆報價單。")
        self.detail_text.configure(state="disabled")

        paned.add(table_frame, weight=3)
        paned.add(detail_frame, weight=2)

    def _build_create_tab(self) -> None:
        self.create_tab.columnconfigure(0, weight=1)
        self.create_tab.rowconfigure(1, weight=1)

        base_frame = ttk.LabelFrame(self.create_tab, text="基本資料", style="Section.TLabelframe")
        base_frame.grid(row=0, column=0, sticky="ew")
        for i in range(4):
            base_frame.columnconfigure(i, weight=1 if i in (1, 3) else 0)

        ttk.Label(base_frame, text="客戶").grid(row=0, column=0, sticky="w", pady=4)
        self.customer_combo = ttk.Combobox(base_frame, textvariable=self.customer_var, state="readonly")
        self.customer_combo.grid(row=0, column=1, sticky="ew", padx=4, pady=4)
        self.customer_combo.bind("<<ComboboxSelected>>", self.on_customer_changed)

        ttk.Label(base_frame, text="聯絡人").grid(row=0, column=2, sticky="w", pady=4)
        self.contact_combo = ttk.Combobox(base_frame, textvariable=self.contact_var, state="readonly")
        self.contact_combo.grid(row=0, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(base_frame, text="報價日期 (YYYY-MM-DD)").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(base_frame, textvariable=self.issue_date_var).grid(row=1, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(base_frame, text="有效日期 (YYYY-MM-DD)").grid(row=1, column=2, sticky="w", pady=4)
        ttk.Entry(base_frame, textvariable=self.expiry_date_var).grid(row=1, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(base_frame, text="幣別").grid(row=2, column=0, sticky="w", pady=4)
        ttk.Entry(base_frame, textvariable=self.currency_var).grid(row=2, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(base_frame, text="稅率 (%)").grid(row=2, column=2, sticky="w", pady=4)
        ttk.Entry(base_frame, textvariable=self.tax_rate_var).grid(row=2, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(base_frame, text="備註").grid(row=3, column=0, sticky="nw", pady=4)
        self.note_entry = tk.Text(base_frame, height=3, wrap="word")
        self.note_entry.grid(row=3, column=1, columnspan=3, sticky="ew", padx=4, pady=4)

        items_frame = ttk.LabelFrame(self.create_tab, text="品項輸入", style="Section.TLabelframe")
        items_frame.grid(row=1, column=0, sticky="nsew", pady=(10, 0))
        items_frame.columnconfigure(0, weight=1)
        items_frame.rowconfigure(2, weight=1)

        helper = (
            "每一行代表一個品項，格式：品名,單位,數量,單價\n"
            "例如：\n"
            "管路施作,式,1,15000\n"
            "8P8C安裝,式,1,5000\n"
            "可使用英文逗號 , 或中文逗號 ，"
        )
        ttk.Label(items_frame, text=helper, justify="left").grid(row=0, column=0, sticky="w", padx=4, pady=(2, 8))

        item_action = ttk.Frame(items_frame)
        item_action.grid(row=1, column=0, sticky="w", padx=2, pady=(0, 6))
        ttk.Button(item_action, text="填入範例", command=self.fill_sample_items).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(item_action, text="清空品項", command=self.clear_items).grid(row=0, column=1, padx=6)

        text_wrap = ttk.Frame(items_frame)
        text_wrap.grid(row=2, column=0, sticky="nsew")
        text_wrap.columnconfigure(0, weight=1)
        text_wrap.rowconfigure(0, weight=1)

        self.items_text = tk.Text(text_wrap, height=14, wrap="none")
        item_y_scroll = ttk.Scrollbar(text_wrap, orient="vertical", command=self.items_text.yview)
        item_x_scroll = ttk.Scrollbar(text_wrap, orient="horizontal", command=self.items_text.xview)
        self.items_text.configure(yscrollcommand=item_y_scroll.set, xscrollcommand=item_x_scroll.set)

        self.items_text.grid(row=0, column=0, sticky="nsew")
        item_y_scroll.grid(row=0, column=1, sticky="ns")
        item_x_scroll.grid(row=1, column=0, sticky="ew")

        bottom_actions = ttk.Frame(items_frame)
        bottom_actions.grid(row=3, column=0, sticky="e", pady=(8, 2))
        ttk.Button(bottom_actions, text="建立報價單", command=self.create_quote).grid(row=0, column=0, padx=4)

    def _set_status(self, message: str, *, is_error: bool = False) -> None:
        self.status_var.set(message)
        self.status_label.configure(style="StatusError.TLabel" if is_error else "StatusOk.TLabel")

    def _ensure_login(self) -> bool:
        if self.api.token:
            return True
        messagebox.showerror("尚未登入", "請先登入系統。")
        return False

    def login(self) -> None:
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        if not username or not password:
            messagebox.showerror("資料不完整", "請輸入帳號與密碼。")
            return

        try:
            self.api.set_base_url(self.base_url_var.get())
            payload = self.api.login(username, password)
        except APIError as exc:
            self._set_status(f"登入失敗: {exc}", is_error=True)
            messagebox.showerror("登入失敗", str(exc))
            return

        user = payload.get("user") or {}
        role = user.get("role", "-")
        self._set_status(f"已登入: {username} ({role})")
        self.load_reference_data()
        self.refresh_quotes()

    def load_reference_data(self) -> None:
        if not self._ensure_login():
            return
        try:
            self.customers = self.api.get_customers()
            self.contacts = self.api.get_contacts()
        except APIError as exc:
            self._set_status(f"載入資料失敗: {exc}", is_error=True)
            messagebox.showerror("載入失敗", str(exc))
            return

        self.populate_customer_options()
        self.on_customer_changed(None)
        self._set_status(f"已載入客戶 {len(self.customers)} 筆、聯絡人 {len(self.contacts)} 筆")

    def populate_customer_options(self) -> None:
        labels: list[str] = []
        self.customer_label_to_id.clear()
        for customer in self.customers:
            customer_id = customer.get("id")
            name = customer.get("name") or ""
            if customer_id is None:
                continue
            label = f"{customer_id} - {name}"
            labels.append(label)
            self.customer_label_to_id[label] = int(customer_id)

        self.customer_combo["values"] = labels
        if labels and self.customer_var.get() not in labels:
            self.customer_var.set(labels[0])

    def on_customer_changed(self, _event: Any) -> None:
        label = self.customer_var.get()
        customer_id = self.customer_label_to_id.get(label)
        filtered = [c for c in self.contacts if customer_id and int(c.get("customer_id", 0)) == customer_id]

        self.contact_label_to_id.clear()
        contact_labels = [""]
        for contact in filtered:
            contact_id = contact.get("id")
            name = contact.get("name") or ""
            if contact_id is None:
                continue
            item = f"{contact_id} - {name}"
            contact_labels.append(item)
            self.contact_label_to_id[item] = int(contact_id)

        self.contact_combo["values"] = contact_labels
        if self.contact_var.get() not in contact_labels:
            self.contact_var.set("")

    def refresh_quotes(self) -> None:
        if not self._ensure_login():
            return

        try:
            self.quotes = self.api.get_quotes()
        except APIError as exc:
            self._set_status(f"讀取報價失敗: {exc}", is_error=True)
            messagebox.showerror("讀取失敗", str(exc))
            return

        for row_id in self.quote_tree.get_children():
            self.quote_tree.delete(row_id)
        self.quote_row_to_data.clear()

        for quote in self.quotes:
            quote_id = quote.get("id")
            if quote_id is None:
                continue
            subtotal = quote.get("subtotal")
            total_amount = quote.get("total_amount")
            amount = subtotal if subtotal is not None else (total_amount or 0)

            row = self.quote_tree.insert(
                "",
                "end",
                values=(
                    quote.get("quote_no", ""),
                    quote.get("status", ""),
                    f"{float(amount):.2f}",
                    quote.get("customer_id", ""),
                    quote.get("issue_date", "") or "",
                ),
            )
            self.quote_row_to_data[row] = quote

        self._set_status(f"報價列表已更新，共 {len(self.quotes)} 筆")

    def on_quote_selected(self, _event: Any) -> None:
        selected = self.quote_tree.selection()
        if not selected:
            return

        quote = self.quote_row_to_data.get(selected[0])
        if not quote:
            return

        lines: list[str] = []
        lines.append(f"單號: {quote.get('quote_no', '')}")
        lines.append(f"狀態: {quote.get('status', '')}")
        lines.append(f"客戶 ID: {quote.get('customer_id', '')}")
        lines.append(f"聯絡人 ID: {quote.get('contact_id', '')}")
        lines.append(f"報價日期: {quote.get('issue_date', '') or '-'}")
        lines.append(f"有效日期: {quote.get('expiry_date', '') or '-'}")
        lines.append(f"幣別: {quote.get('currency', '')}")
        subtotal = float(quote.get("subtotal") or 0)
        tax_amount = float(quote.get("tax_amount") or 0)
        total_amount = float(quote.get("total_amount") or 0)
        lines.append(f"未稅金額: {subtotal:.2f}")
        lines.append(f"稅額: {tax_amount:.2f}")
        lines.append(f"總金額: {total_amount:.2f}")
        lines.append("")
        lines.append("品項:")

        items = quote.get("items") or []
        if not items:
            lines.append("- (無品項)")
        else:
            for idx, item in enumerate(items, start=1):
                lines.append(
                    f"{idx}. {item.get('description', '')} | 單位: {item.get('unit', '')} | "
                    f"數量: {float(item.get('quantity') or 0):.2f} | "
                    f"單價: {float(item.get('unit_price') or 0):.2f} | "
                    f"金額: {float(item.get('amount') or 0):.2f}"
                )

        note = (quote.get("note") or "").strip()
        if note:
            lines.append("")
            lines.append(f"備註: {note}")

        self.detail_text.configure(state="normal")
        self.detail_text.delete("1.0", tk.END)
        self.detail_text.insert("1.0", "\n".join(lines))
        self.detail_text.configure(state="disabled")

    def _selected_quote_id(self) -> int | None:
        selected = self.quote_tree.selection()
        if not selected:
            messagebox.showerror("未選取資料", "請先在列表中選擇一筆報價單。")
            return None
        quote = self.quote_row_to_data.get(selected[0])
        if not quote:
            messagebox.showerror("資料錯誤", "找不到所選的報價資料。")
            return None
        quote_id = quote.get("id")
        if quote_id is None:
            messagebox.showerror("資料錯誤", "這筆報價沒有 id。")
            return None
        return int(quote_id)

    def open_selected_pdf(self) -> None:
        if not self._ensure_login():
            return
        quote_id = self._selected_quote_id()
        if quote_id is None:
            return

        try:
            binary = self.api.download_quote_pdf(quote_id)
            path = self._save_temp_file(binary, ".pdf", f"quote-{quote_id}-")
            self._open_file(path)
            self._set_status(f"已開啟 PDF: quote-{quote_id}")
        except APIError as exc:
            self._set_status(f"PDF 下載失敗: {exc}", is_error=True)
            messagebox.showerror("PDF 下載失敗", str(exc))

    def open_selected_xlsx(self) -> None:
        if not self._ensure_login():
            return
        quote_id = self._selected_quote_id()
        if quote_id is None:
            return

        try:
            binary = self.api.download_quote_xlsx(quote_id)
            path = self._save_temp_file(binary, ".xlsx", f"quote-{quote_id}-")
            self._open_file(path)
            self._set_status(f"已開啟 XLSX: quote-{quote_id}")
        except APIError as exc:
            self._set_status(f"XLSX 下載失敗: {exc}", is_error=True)
            messagebox.showerror("XLSX 下載失敗", str(exc))

    @staticmethod
    def _save_temp_file(content: bytes, suffix: str, prefix: str) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix) as temp_file:
            temp_file.write(content)
            return temp_file.name

    @staticmethod
    def _open_file(path: str) -> None:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=False)
            return
        subprocess.run(["xdg-open", path], check=False)

    def clear_items(self) -> None:
        self.items_text.delete("1.0", tk.END)

    def fill_sample_items(self) -> None:
        self.items_text.delete("1.0", tk.END)
        self.items_text.insert("1.0", "管路施作,式,1,15000\n8P8C安裝,式,1,5000")

    def create_quote(self) -> None:
        if not self._ensure_login():
            return

        customer_label = self.customer_var.get()
        customer_id = self.customer_label_to_id.get(customer_label)
        if not customer_id:
            messagebox.showerror("資料不完整", "請選擇客戶。")
            return

        contact_id = self.contact_label_to_id.get(self.contact_var.get())
        note = self.note_entry.get("1.0", tk.END).strip()

        try:
            tax_rate = float((self.tax_rate_var.get() or "0").strip())
        except ValueError:
            messagebox.showerror("資料格式錯誤", "稅率必須是數字。")
            return

        issue_date_text = self.issue_date_var.get().strip()
        expiry_date_text = self.expiry_date_var.get().strip()

        if issue_date_text:
            try:
                date.fromisoformat(issue_date_text)
            except ValueError:
                messagebox.showerror("日期格式錯誤", "報價日期格式需為 YYYY-MM-DD")
                return
        if expiry_date_text:
            try:
                date.fromisoformat(expiry_date_text)
            except ValueError:
                messagebox.showerror("日期格式錯誤", "有效日期格式需為 YYYY-MM-DD")
                return

        raw_items = self.items_text.get("1.0", tk.END)
        try:
            items = self._parse_items(raw_items)
        except APIError as exc:
            messagebox.showerror("品項格式錯誤", str(exc))
            return

        payload: dict[str, Any] = {
            "customer_id": customer_id,
            "contact_id": contact_id,
            "issue_date": issue_date_text or None,
            "expiry_date": expiry_date_text or None,
            "currency": (self.currency_var.get() or "TWD").strip().upper(),
            "tax_rate": tax_rate,
            "note": note,
            "items": items,
        }

        if not payload["contact_id"]:
            payload["contact_id"] = None

        try:
            quote = self.api.create_quote(payload)
        except APIError as exc:
            self._set_status(f"建立報價失敗: {exc}", is_error=True)
            messagebox.showerror("建立失敗", str(exc))
            return

        quote_no = quote.get("quote_no", "(無單號)")
        self._set_status(f"建立成功: {quote_no}")
        messagebox.showinfo("建立成功", f"報價單已建立：{quote_no}")
        self.refresh_quotes()

    def _parse_items(self, raw_text: str) -> list[dict[str, Any]]:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            raise APIError("請至少輸入一筆品項。")

        items: list[dict[str, Any]] = []
        for idx, line in enumerate(lines, start=1):
            normalized = line.replace("，", ",")
            parts = [p.strip() for p in normalized.split(",")]
            if len(parts) != 4:
                raise APIError(f"第 {idx} 行格式錯誤，請使用：品名,單位,數量,單價")

            description, unit, quantity_text, unit_price_text = parts
            if not description:
                raise APIError(f"第 {idx} 行缺少品名。")

            try:
                quantity = float(quantity_text)
                unit_price = float(unit_price_text)
            except ValueError as exc:
                raise APIError(f"第 {idx} 行數量或單價不是數字。") from exc

            items.append(
                {
                    "description": description,
                    "unit": unit or "式",
                    "quantity": quantity,
                    "unit_price": unit_price,
                }
            )

        return items


def main() -> None:
    root = tk.Tk()
    DesktopQuoteTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
