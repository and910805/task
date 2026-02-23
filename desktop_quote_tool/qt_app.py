from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont, QFontDatabase
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStatusBar,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app import APIError, TaskGoAPI


class DesktopQuoteToolQt(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("TaskGo 會計報價工具 (Qt)")
        self.resize(1280, 820)
        self.setMinimumSize(1100, 720)

        self.api = TaskGoAPI()
        self.customers: list[dict[str, Any]] = []
        self.contacts: list[dict[str, Any]] = []
        self.catalog_items: list[dict[str, Any]] = []
        self.quotes: list[dict[str, Any]] = []
        self.current_items: list[dict[str, Any]] = []

        self.customer_map: dict[str, int] = {}
        self.contact_map: dict[str, int] = {}
        self.catalog_map: dict[str, dict[str, Any]] = {}
        self.editing_item_index: int | None = None
        self._busy_buttons: list[QPushButton] = []
        self._busy_depth = 0

        self._build_ui()
        self._set_status("尚未登入")

    def _build_ui(self) -> None:
        self.setStatusBar(QStatusBar(self))
        font = QFont(self._pick_font_family())
        font.setPointSize(10)
        self.setFont(font)
        self._apply_theme()

        root = QWidget(self)
        self.setCentralWidget(root)
        root_layout = QVBoxLayout(root)
        root_layout.setContentsMargins(12, 12, 12, 12)
        root_layout.setSpacing(10)
        root_layout.addWidget(self._build_top_panel())

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.query_tab = QWidget()
        self.create_tab = QWidget()
        self.tabs.addTab(self.query_tab, "報價查詢")
        self.tabs.addTab(self.create_tab, "建立估價單")
        root_layout.addWidget(self.tabs, 1)

        self._build_query_tab()
        self._build_create_tab()

    def _apply_theme(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow { background: #f4f7fb; }
            QStatusBar { background: #edf2f7; color: #334155; border-top: 1px solid #dbe3ef; }
            QGroupBox {
                background: #fff; border: 1px solid #dbe3ef; border-radius: 12px;
                margin-top: 12px; font-weight: 700; color: #0f172a;
            }
            QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 6px; }
            QTabWidget::pane { border: 1px solid #dbe3ef; background: #fff; border-radius: 12px; top: -1px; }
            QTabBar::tab {
                background: #e8eef7; color: #334155; border: 1px solid #dbe3ef;
                padding: 8px 14px; margin-right: 4px; border-top-left-radius: 8px; border-top-right-radius: 8px;
            }
            QTabBar::tab:selected { background: #fff; color: #0f172a; border-bottom-color: #fff; }
            QLineEdit, QComboBox, QTextEdit {
                background: #fff; border: 1px solid #cbd5e1; border-radius: 8px;
                padding: 6px 8px; color: #0f172a;
            }
            QLineEdit:focus, QComboBox:focus, QTextEdit:focus { border: 1px solid #3b82f6; }
            QComboBox::drop-down { border: none; width: 22px; }
            QPushButton {
                background: #e2e8f0; color: #1e293b; border: 1px solid #cbd5e1;
                border-radius: 8px; padding: 6px 12px; font-weight: 600;
            }
            QPushButton:hover { background: #dbe5f2; }
            QPushButton:pressed { background: #cfd9e6; }
            QPushButton[variant="primary"] { background: #0ea5e9; color: #fff; border: 1px solid #0284c7; }
            QPushButton[variant="primary"]:hover { background: #0284c7; }
            QPushButton[variant="accent"] { background: #16a34a; color: #fff; border: 1px solid #15803d; }
            QPushButton[variant="accent"]:hover { background: #15803d; }
            QLabel[role="status"] {
                color: #0f172a; background: #e0f2fe; border: 1px solid #bae6fd;
                border-radius: 999px; padding: 4px 10px; font-weight: 700;
            }
            QTableWidget {
                background: #fff; alternate-background-color: #f8fbff; border: 1px solid #dbe3ef;
                border-radius: 10px; gridline-color: #e8eef7; selection-background-color: #dbeafe; selection-color: #0f172a;
            }
            QHeaderView::section {
                background: #f1f5f9; color: #334155; border: none; border-bottom: 1px solid #dbe3ef;
                border-right: 1px solid #e8eef7; padding: 8px 6px; font-weight: 700;
            }
            QSplitter::handle { background: #e2e8f0; height: 6px; }
            """
        )

    @staticmethod
    def _pick_font_family() -> str:
        families = set(QFontDatabase.families())
        if sys.platform.startswith("win"):
            candidates = ["Microsoft JhengHei UI", "Microsoft JhengHei", "PMingLiU"]
        elif sys.platform.startswith("linux"):
            candidates = ["Noto Sans CJK TC", "Noto Sans TC", "Noto Sans CJK JP"]
        else:
            candidates = ["PingFang TC", "Heiti TC", "Noto Sans CJK TC"]
        for name in candidates:
            if name in families:
                return name
        return QApplication.font().family()

    @staticmethod
    def _style_button(button: QPushButton, variant: str | None = None) -> None:
        if variant:
            button.setProperty("variant", variant)
            button.style().unpolish(button)
            button.style().polish(button)
        button.setCursor(Qt.PointingHandCursor)
        button.setMinimumHeight(34)

    def _track_busy_button(self, button: QPushButton) -> QPushButton:
        self._busy_buttons.append(button)
        return button

    @staticmethod
    def _style_table(table: QTableWidget) -> None:
        table.setAlternatingRowColors(True)
        table.setSelectionBehavior(QTableWidget.SelectRows)
        table.setSelectionMode(QTableWidget.SingleSelection)
        table.setEditTriggers(QTableWidget.NoEditTriggers)
        table.setWordWrap(False)
        table.verticalHeader().setVisible(False)
        table.verticalHeader().setDefaultSectionSize(34)
        try:
            table.horizontalHeader().setStretchLastSection(True)
        except Exception:
            pass

    def _build_top_panel(self) -> QWidget:
        group = QGroupBox("系統連線")
        layout = QGridLayout(group)
        layout.setHorizontalSpacing(8)
        layout.setVerticalSpacing(8)

        self.base_url_edit = QLineEdit("https://task.kuanlin.pro")
        self.username_edit = QLineEdit()
        self.password_edit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.status_label = QLabel("尚未登入")
        self.status_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.status_label.setProperty("role", "status")
        self.base_url_edit.setPlaceholderText("https://task.kuanlin.pro")
        self.username_edit.setPlaceholderText("帳號")
        self.password_edit.setPlaceholderText("密碼")

        btn_login = QPushButton("登入")
        btn_master = QPushButton("載入主檔")
        btn_refresh = QPushButton("刷新報價")
        self._track_busy_button(btn_login)
        self._track_busy_button(btn_master)
        self._track_busy_button(btn_refresh)
        self._style_button(btn_login, "primary")
        self._style_button(btn_master)
        self._style_button(btn_refresh)
        btn_login.clicked.connect(self.login)
        btn_master.clicked.connect(self.load_master)
        btn_refresh.clicked.connect(self.refresh_quotes)

        layout.addWidget(QLabel("網址"), 0, 0)
        layout.addWidget(self.base_url_edit, 0, 1)
        layout.addWidget(QLabel("帳號"), 0, 2)
        layout.addWidget(self.username_edit, 0, 3)
        layout.addWidget(QLabel("密碼"), 0, 4)
        layout.addWidget(self.password_edit, 0, 5)
        layout.addWidget(btn_login, 0, 6)
        layout.addWidget(btn_master, 0, 7)
        layout.addWidget(btn_refresh, 0, 8)
        layout.addWidget(self.status_label, 0, 9)
        layout.setColumnStretch(1, 3)
        layout.setColumnStretch(3, 1)
        layout.setColumnStretch(5, 1)
        layout.setColumnStretch(9, 2)
        return group

    def _build_query_tab(self) -> None:
        layout = QVBoxLayout(self.query_tab)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        actions = QHBoxLayout()
        actions.setSpacing(8)
        btn_refresh = QPushButton("重新整理")
        btn_local_pdf = QPushButton("PDF（地端繁中）")
        btn_server_pdf = QPushButton("PDF（系統）")
        btn_xlsx = QPushButton("XLSX")
        self._track_busy_button(btn_refresh)
        self._track_busy_button(btn_server_pdf)
        self._track_busy_button(btn_xlsx)
        for btn, variant in (
            (btn_refresh, None),
            (btn_local_pdf, None),
            (btn_server_pdf, "primary"),
            (btn_xlsx, None),
        ):
            self._style_button(btn, variant)
        btn_refresh.clicked.connect(self.refresh_quotes)
        btn_local_pdf.clicked.connect(self.show_local_pdf_not_migrated_message)
        btn_server_pdf.clicked.connect(self.open_server_pdf)
        btn_xlsx.clicked.connect(self.open_xlsx)
        actions.addWidget(btn_refresh)
        actions.addWidget(btn_local_pdf)
        actions.addWidget(btn_server_pdf)
        actions.addWidget(btn_xlsx)
        actions.addStretch(1)
        layout.addLayout(actions)

        splitter = QSplitter(Qt.Vertical)
        layout.addWidget(splitter, 1)

        list_group = QGroupBox("報價列表")
        list_layout = QVBoxLayout(list_group)
        self.quote_table = QTableWidget(0, 5)
        self.quote_table.setHorizontalHeaderLabels(["單號", "狀態", "金額", "客戶", "日期"])
        self._style_table(self.quote_table)
        self.quote_table.itemSelectionChanged.connect(self.show_quote_detail)
        list_layout.addWidget(self.quote_table)

        detail_group = QGroupBox("明細")
        detail_layout = QVBoxLayout(detail_group)
        self.detail_text = QTextEdit()
        self.detail_text.setReadOnly(True)
        self.detail_text.setMinimumHeight(180)
        self.detail_text.setPlainText("請在上方選擇一筆報價。")
        detail_layout.addWidget(self.detail_text)

        splitter.addWidget(list_group)
        splitter.addWidget(detail_group)
        splitter.setSizes([430, 240])

    def _build_create_tab(self) -> None:
        layout = QVBoxLayout(self.create_tab)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        base_group = QGroupBox("基本資料")
        base_form = QGridLayout(base_group)
        base_form.setHorizontalSpacing(8)
        base_form.setVerticalSpacing(8)

        self.customer_combo = QComboBox()
        self.customer_combo.currentTextChanged.connect(lambda _v: self.on_customer_changed())
        self.contact_combo = QComboBox()
        self.issue_date_edit = QLineEdit(date.today().isoformat())
        self.expiry_date_edit = QLineEdit((date.today() + timedelta(days=10)).isoformat())
        self.currency_edit = QLineEdit("TWD")
        self.note_edit = QLineEdit()
        self.issue_date_edit.setPlaceholderText("YYYY-MM-DD")
        self.expiry_date_edit.setPlaceholderText("YYYY-MM-DD")
        self.currency_edit.setMaxLength(8)
        self.note_edit.setPlaceholderText("例如：施工說明、付款備註")

        base_form.addWidget(QLabel("客戶"), 0, 0)
        base_form.addWidget(self.customer_combo, 0, 1)
        base_form.addWidget(QLabel("聯絡人"), 0, 2)
        base_form.addWidget(self.contact_combo, 0, 3)
        base_form.addWidget(QLabel("報價日期"), 1, 0)
        base_form.addWidget(self.issue_date_edit, 1, 1)
        base_form.addWidget(QLabel("有效日期"), 1, 2)
        base_form.addWidget(self.expiry_date_edit, 1, 3)
        base_form.addWidget(QLabel("幣別"), 2, 0)
        base_form.addWidget(self.currency_edit, 2, 1)
        base_form.addWidget(QLabel("稅率"), 2, 2)
        base_form.addWidget(QLabel("固定 0%（未稅）"), 2, 3)
        base_form.addWidget(QLabel("備註"), 3, 0)
        base_form.addWidget(self.note_edit, 3, 1, 1, 3)
        for col in (1, 3):
            base_form.setColumnStretch(col, 1)
        layout.addWidget(base_group)

        items_group = QGroupBox("品項")
        items_layout = QVBoxLayout(items_group)
        items_layout.setSpacing(8)

        source_layout = QGridLayout()
        source_layout.setHorizontalSpacing(8)
        source_layout.setVerticalSpacing(6)
        self.catalog_combo = QComboBox()
        self.item_desc_edit = QLineEdit()
        self.item_unit_edit = QLineEdit("式")
        self.item_qty_edit = QLineEdit("1")
        self.item_price_edit = QLineEdit("0")
        self.total_label = QLabel("0.00")
        self.total_label.setStyleSheet("font-size:16px; font-weight:700; color:#0f172a;")
        self.item_desc_edit.setPlaceholderText("品名 / 規格內容")
        self.item_unit_edit.setMaximumWidth(90)
        self.item_qty_edit.setMaximumWidth(110)
        self.item_price_edit.setMaximumWidth(130)

        btn_add_catalog = QPushButton("帶入")
        btn_add_manual = QPushButton("手動新增")
        btn_load_selected = QPushButton("載入選取")
        btn_update_selected = QPushButton("更新選取")
        for btn, variant in (
            (btn_add_catalog, None),
            (btn_add_manual, "primary"),
            (btn_load_selected, None),
            (btn_update_selected, None),
        ):
            self._style_button(btn, variant)
        btn_add_catalog.clicked.connect(self.add_from_catalog)
        btn_add_manual.clicked.connect(self.add_manual_item)
        btn_load_selected.clicked.connect(self.load_selected_item_for_edit)
        btn_update_selected.clicked.connect(self.update_selected_item)

        source_layout.addWidget(QLabel("價目表"), 0, 0)
        source_layout.addWidget(self.catalog_combo, 0, 1, 1, 3)
        source_layout.addWidget(btn_add_catalog, 0, 4)
        source_layout.addWidget(self.item_desc_edit, 1, 1)
        source_layout.addWidget(self.item_unit_edit, 1, 2)
        source_layout.addWidget(self.item_qty_edit, 1, 3)
        source_layout.addWidget(self.item_price_edit, 1, 4)
        source_layout.addWidget(btn_add_manual, 1, 5)
        source_layout.addWidget(btn_load_selected, 1, 6)
        source_layout.addWidget(btn_update_selected, 1, 7)
        source_layout.addWidget(QLabel("品名"), 2, 1)
        source_layout.addWidget(QLabel("單位"), 2, 2)
        source_layout.addWidget(QLabel("數量"), 2, 3)
        source_layout.addWidget(QLabel("單價"), 2, 4)
        source_layout.setColumnStretch(1, 1)
        items_layout.addLayout(source_layout)

        self.item_table = QTableWidget(0, 5)
        self.item_table.setHorizontalHeaderLabels(["品名", "單位", "數量", "單價", "小計"])
        self._style_table(self.item_table)
        self.item_table.cellDoubleClicked.connect(lambda *_: self.load_selected_item_for_edit())
        items_layout.addWidget(self.item_table, 1)

        bottom = QHBoxLayout()
        bottom.setSpacing(8)
        btn_up = QPushButton("上移")
        btn_down = QPushButton("下移")
        btn_remove = QPushButton("刪除選取")
        btn_clear = QPushButton("清空全部")
        btn_create = QPushButton("建立估價單")
        self._track_busy_button(btn_create)
        for btn, variant in (
            (btn_up, None),
            (btn_down, None),
            (btn_remove, None),
            (btn_clear, None),
            (btn_create, "accent"),
        ):
            self._style_button(btn, variant)
        btn_up.clicked.connect(lambda: self.move_selected_item(-1))
        btn_down.clicked.connect(lambda: self.move_selected_item(1))
        btn_remove.clicked.connect(self.remove_selected_item)
        btn_clear.clicked.connect(self.clear_items)
        btn_create.clicked.connect(self.create_quote)

        bottom.addWidget(btn_up)
        bottom.addWidget(btn_down)
        bottom.addWidget(btn_remove)
        bottom.addWidget(btn_clear)
        bottom.addSpacing(12)
        bottom.addWidget(QLabel("未稅合計"))
        bottom.addWidget(self.total_label)
        bottom.addStretch(1)
        bottom.addWidget(btn_create)
        items_layout.addLayout(bottom)

        layout.addWidget(items_group, 1)

    def _set_status(self, text: str) -> None:
        self.status_label.setText(text)
        if self.statusBar():
            self.statusBar().showMessage(text)

    def _set_busy(self, busy: bool, message: str | None = None) -> None:
        if busy:
            self._busy_depth += 1
            if self._busy_depth > 1:
                return
            for btn in self._busy_buttons:
                btn.setEnabled(False)
            QApplication.setOverrideCursor(Qt.WaitCursor)
            if message:
                self._set_status(message)
            return

        if self._busy_depth == 0:
            return
        self._busy_depth -= 1
        if self._busy_depth > 0:
            return
        for btn in self._busy_buttons:
            btn.setEnabled(True)
        QApplication.restoreOverrideCursor()

    def _error(self, title: str, message: str) -> None:
        QMessageBox.critical(self, title, message)

    def _info(self, title: str, message: str) -> None:
        QMessageBox.information(self, title, message)

    def show_local_pdf_not_migrated_message(self) -> None:
        self._info("尚未完成", "Qt 版尚未搬移地端 PDF 蓋章輸出；請先使用「PDF（系統）」或原本 tkinter 版 app.py。")

    def _require_login(self) -> bool:
        if self.api.token:
            return True
        self._error("尚未登入", "請先登入系統。")
        return False

    def login(self) -> None:
        self._set_busy(True, "登入中...")
        username = self.username_edit.text().strip()
        password = self.password_edit.text().strip()
        try:
            if not username or not password:
                self._error("資料不完整", "請輸入帳號與密碼。")
                return
            try:
                self.api.set_base_url(self.base_url_edit.text().strip())
                self.api.login(username, password)
                self._set_status("登入成功")
                self.load_master()
                self.refresh_quotes()
            except APIError as exc:
                self._set_status(f"登入失敗: {exc}")
                self._error("登入失敗", str(exc))
        finally:
            self._set_busy(False)

    def load_master(self) -> None:
        self._set_busy(True, "載入主檔中...")
        if not self._require_login():
            self._set_busy(False)
            return
        try:
            try:
                self.customers = self.api.get_customers()
                self.contacts = self.api.get_contacts()
                self.catalog_items = self.api.get_catalog_items()
            except APIError as exc:
                self._set_status(f"載入失敗: {exc}")
                self._error("載入失敗", str(exc))
                return
            self._populate_customers()
            self._populate_catalog()
            self.on_customer_changed()
            self._set_status(f"主檔完成 客戶{len(self.customers)} 價目{len(self.catalog_items)}")
        finally:
            self._set_busy(False)

    def _populate_customers(self) -> None:
        current_text = self.customer_combo.currentText()
        self.customer_map.clear()
        self.customer_combo.clear()
        for c in self.customers:
            cid = c.get("id")
            if cid is None:
                continue
            label = f"{cid} - {c.get('name', '')}"
            self.customer_combo.addItem(label)
            self.customer_map[label] = int(cid)
        idx = self.customer_combo.findText(current_text)
        if idx >= 0:
            self.customer_combo.setCurrentIndex(idx)
        elif self.customer_combo.count() > 0:
            self.customer_combo.setCurrentIndex(0)

    def _populate_catalog(self) -> None:
        current_text = self.catalog_combo.currentText()
        self.catalog_map.clear()
        self.catalog_combo.clear()
        for item in self.catalog_items:
            iid = item.get("id")
            if iid is None:
                continue
            unit = item.get("unit") or "式"
            price = float(item.get("unit_price") or 0)
            label = f"{iid} - {item.get('name', '')}（{unit} / {price:.0f}）"
            self.catalog_combo.addItem(label)
            self.catalog_map[label] = item
        idx = self.catalog_combo.findText(current_text)
        if idx >= 0:
            self.catalog_combo.setCurrentIndex(idx)
        elif self.catalog_combo.count() > 0:
            self.catalog_combo.setCurrentIndex(0)

    def on_customer_changed(self) -> None:
        cid = self.customer_map.get(self.customer_combo.currentText())
        prev = self.contact_combo.currentText()
        self.contact_map.clear()
        self.contact_combo.clear()
        self.contact_combo.addItem("")
        for c in self.contacts:
            if cid and int(c.get("customer_id") or 0) == cid:
                label = f"{c.get('id')} - {c.get('name', '')}"
                self.contact_combo.addItem(label)
                self.contact_map[label] = int(c.get("id") or 0)
        idx = self.contact_combo.findText(prev)
        self.contact_combo.setCurrentIndex(idx if idx >= 0 else 0)

    def _customer_name(self, customer_id: Any) -> str:
        for c in self.customers:
            if str(c.get("id")) == str(customer_id):
                return str(c.get("name") or customer_id)
        return str(customer_id or "")

    def refresh_quotes(self) -> None:
        self._set_busy(True, "載入報價中...")
        if not self._require_login():
            self._set_busy(False)
            return
        try:
            self.quotes = self.api.get_quotes()
        except APIError as exc:
            self._set_status(f"報價讀取失敗: {exc}")
            self._error("讀取失敗", str(exc))
            self._set_busy(False)
            return

        try:
            self.quote_table.setSortingEnabled(False)
            self.quote_table.setRowCount(0)
            display_row = 0
            for q in self.quotes:
                if q.get("id") is None:
                    continue
                self.quote_table.insertRow(display_row)
                amount = float(q.get("subtotal") if q.get("subtotal") is not None else q.get("total_amount") or 0)
                values = [
                    str(q.get("quote_no", "")),
                    str(q.get("status", "")),
                    f"{amount:.2f}",
                    self._customer_name(q.get("customer_id")),
                    str(q.get("issue_date") or ""),
                ]
                for col, value in enumerate(values):
                    cell = QTableWidgetItem(value)
                    if col == 2:
                        cell.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                        cell.setData(Qt.ItemDataRole.EditRole, amount)
                    self.quote_table.setItem(display_row, col, cell)
                first = self.quote_table.item(display_row, 0)
                if first is not None:
                    first.setData(Qt.UserRole, q)
                display_row += 1
            self.quote_table.setSortingEnabled(True)
            self._set_status(f"報價共 {len(self.quotes)} 筆")
        finally:
            self._set_busy(False)

    def _selected_quote(self, *, show_error: bool = True) -> dict[str, Any] | None:
        row = self.quote_table.currentRow()
        if row < 0:
            if show_error:
                self._error("未選取", "請先選一筆報價。")
            return None
        item = self.quote_table.item(row, 0)
        if item is None:
            if show_error:
                self._error("資料錯誤", "找不到選取的報價。")
            return None
        data = item.data(Qt.UserRole)
        return data if isinstance(data, dict) else None

    def show_quote_detail(self) -> None:
        q = self._selected_quote(show_error=False)
        if not q:
            self.detail_text.setPlainText("請在上方選擇一筆報價。")
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
            lines.append(
                f"{idx}. {item.get('description', '')} | {item.get('unit', '')} | "
                f"{float(item.get('quantity') or 0):.2f} x {float(item.get('unit_price') or 0):.2f}"
            )
        self.detail_text.setPlainText("\n".join(lines))

    def open_server_pdf(self) -> None:
        self._set_busy(True, "下載 PDF 中...")
        q = self._selected_quote()
        if not q:
            self._set_busy(False)
            return
        qid = int(q.get("id") or 0)
        if qid <= 0:
            self._set_busy(False)
            return
        try:
            data = self.api.download_quote_pdf(qid)
            path = self._save_temp(data, ".pdf", "quote-server-")
            self._open_file(path)
        except APIError as exc:
            self._error("PDF 錯誤", str(exc))
        finally:
            self._set_busy(False)

    def open_xlsx(self) -> None:
        self._set_busy(True, "下載 XLSX 中...")
        q = self._selected_quote()
        if not q:
            self._set_busy(False)
            return
        qid = int(q.get("id") or 0)
        if qid <= 0:
            self._set_busy(False)
            return
        try:
            data = self.api.download_quote_xlsx(qid)
            path = self._save_temp(data, ".xlsx", "quote-")
            self._open_file(path)
        except APIError as exc:
            self._error("XLSX 錯誤", str(exc))
        finally:
            self._set_busy(False)

    def add_from_catalog(self) -> None:
        item = self.catalog_map.get(self.catalog_combo.currentText())
        if not item:
            self._error("未選擇", "請先選擇價目。")
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
        desc = self.item_desc_edit.text().strip()
        if not desc:
            self._error("資料不完整", "請輸入品名。")
            return None
        try:
            qty = float((self.item_qty_edit.text() or "0").strip())
            price = float((self.item_price_edit.text() or "0").strip())
        except ValueError:
            self._error("格式錯誤", "數量、單價需為數字。")
            return None
        if qty < 0 or price < 0:
            self._error("格式錯誤", "數量、單價不可小於 0。")
            return None
        return {
            "description": desc,
            "unit": (self.item_unit_edit.text() or "式").strip() or "式",
            "quantity": qty,
            "unit_price": price,
        }

    def _reset_item_input(self) -> None:
        self.item_desc_edit.setText("")
        self.item_unit_edit.setText("式")
        self.item_qty_edit.setText("1")
        self.item_price_edit.setText("0")

    def _selected_item_index(self, *, show_error: bool = True) -> int | None:
        row = self.item_table.currentRow()
        if row < 0:
            if show_error:
                self._error("未選取", "請先選擇品項。")
            return None
        if row >= len(self.current_items):
            if show_error:
                self._error("資料錯誤", "找不到選取的品項索引。")
            return None
        return row

    def load_selected_item_for_edit(self) -> None:
        idx = self._selected_item_index()
        if idx is None:
            return
        item = self.current_items[idx]
        self.item_desc_edit.setText(str(item.get("description") or ""))
        self.item_unit_edit.setText(str(item.get("unit") or "式"))
        self.item_qty_edit.setText(str(item.get("quantity") or 0))
        self.item_price_edit.setText(str(item.get("unit_price") or 0))
        self.editing_item_index = idx
        self._set_status(f"已載入第 {idx + 1} 筆，修改後按「更新選取」")

    def update_selected_item(self) -> None:
        idx = self.editing_item_index if self.editing_item_index is not None else self._selected_item_index()
        if idx is None or idx < 0 or idx >= len(self.current_items):
            return
        item = self._collect_item_from_input()
        if item is None:
            return
        self.current_items[idx] = item
        self.editing_item_index = None
        self._reset_item_input()
        self._refresh_items(select_index=idx)
        self._set_status(f"已更新第 {idx + 1} 筆品項")

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
        self.editing_item_index = None
        self._refresh_items(select_index=target)
        self._set_status(f"已調整品項順序：第 {idx + 1} 筆 -> 第 {target + 1} 筆")

    def remove_selected_item(self) -> None:
        idx = self._selected_item_index()
        if idx is None:
            return
        self.current_items.pop(idx)
        self.editing_item_index = None
        next_idx = min(idx, len(self.current_items) - 1) if self.current_items else None
        self._refresh_items(select_index=next_idx)

    def clear_items(self) -> None:
        self.current_items.clear()
        self.editing_item_index = None
        self._refresh_items()

    def _refresh_items(self, *, select_index: int | None = None) -> None:
        self.item_table.setRowCount(0)
        total = 0.0
        for idx, item in enumerate(self.current_items):
            self.item_table.insertRow(idx)
            qty = float(item["quantity"])
            price = float(item["unit_price"])
            amount = qty * price
            total += amount
            values = [str(item["description"]), str(item["unit"]), f"{qty:.2f}", f"{price:.2f}", f"{amount:.2f}"]
            for col, value in enumerate(values):
                cell = QTableWidgetItem(value)
                if col in (2, 3, 4):
                    cell.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
                self.item_table.setItem(idx, col, cell)
        if select_index is not None and 0 <= select_index < self.item_table.rowCount():
            self.item_table.selectRow(select_index)
            self.item_table.setCurrentCell(select_index, 0)
        self.total_label.setText(f"{total:.2f}")

    def create_quote(self) -> None:
        self._set_busy(True, "建立估價單中...")
        if not self._require_login():
            self._set_busy(False)
            return
        customer_label = self.customer_combo.currentText()
        customer_id = self.customer_map.get(customer_label)
        if not customer_id:
            self._error("資料不完整", "請選擇客戶。")
            self._set_busy(False)
            return
        if not self.current_items:
            self._error("資料不完整", "請至少加入一筆品項。")
            self._set_busy(False)
            return

        issue = self.issue_date_edit.text().strip()
        expiry = self.expiry_date_edit.text().strip()
        for label, value in (("報價日期", issue), ("有效日期", expiry)):
            if value:
                try:
                    date.fromisoformat(value)
                except ValueError:
                    self._error("日期格式錯誤", f"{label}需為 YYYY-MM-DD")
                    self._set_busy(False)
                    return

        payload = {
            "customer_id": customer_id,
            "contact_id": self.contact_map.get(self.contact_combo.currentText()) or None,
            "recipient_name": (self.contact_combo.currentText().strip() or customer_label.strip() or None),
            "issue_date": issue or None,
            "expiry_date": expiry or None,
            "currency": (self.currency_edit.text() or "TWD").strip().upper(),
            "tax_rate": 0,
            "note": self.note_edit.text().strip(),
            "items": [
                {
                    "description": str(i["description"]),
                    "unit": str(i["unit"]),
                    "quantity": float(i["quantity"]),
                    "unit_price": float(i["unit_price"]),
                }
                for i in self.current_items
            ],
        }
        try:
            try:
                created = self.api.create_quote(payload)
            except APIError as exc:
                self._error("建立失敗", str(exc))
                return

            self._info("建立成功", f"已建立：{created.get('quote_no', '(無單號)')}")
            self.current_items.clear()
            self.editing_item_index = None
            self._reset_item_input()
            self.note_edit.setText("")
            self.issue_date_edit.setText(date.today().isoformat())
            self.expiry_date_edit.setText((date.today() + timedelta(days=10)).isoformat())
            self._refresh_items()
            self.refresh_quotes()
        finally:
            self._set_busy(False)

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
    app = QApplication(sys.argv)
    win = DesktopQuoteToolQt()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
