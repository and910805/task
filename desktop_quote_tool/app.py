from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import tkinter as tk
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
            raise APIError("Base URL is empty")
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            raise APIError("Base URL must start with http:// or https://")
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
                raise APIError("Please login first")
            headers["Authorization"] = f"Bearer {self.token}"

        url = urljoin(f"{self.base_url}/", path.lstrip("/"))
        try:
            response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
        except requests.RequestException as exc:
            raise APIError(f"Network error: {exc}") from exc

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
            raise APIError("Login succeeded but token is missing")
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
        self.root.title("TaskGo Accountant Tool")
        self.root.geometry("1160x760")

        self.api = TaskGoAPI()
        self.customers: list[dict[str, Any]] = []
        self.contacts: list[dict[str, Any]] = []
        self.quotes: list[dict[str, Any]] = []
        self.quote_row_to_data: dict[str, dict[str, Any]] = {}

        self.base_url_var = tk.StringVar(value="https://task.kuanlin.pro")
        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()
        self.status_var = tk.StringVar(value="Not logged in")

        self.customer_var = tk.StringVar()
        self.contact_var = tk.StringVar()
        self.issue_date_var = tk.StringVar(value=date.today().isoformat())
        self.expiry_date_var = tk.StringVar()
        self.currency_var = tk.StringVar(value="TWD")
        self.tax_rate_var = tk.StringVar(value="0")
        self.note_var = tk.StringVar()

        self.customer_label_to_id: dict[str, int] = {}
        self.contact_label_to_id: dict[str, int] = {}

        self._build_ui()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        top = ttk.Frame(self.root, padding=10)
        top.grid(row=0, column=0, sticky="ew")
        for i in range(9):
            top.columnconfigure(i, weight=1 if i in (1, 3, 5, 8) else 0)

        ttk.Label(top, text="Base URL").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.base_url_var).grid(row=0, column=1, sticky="ew", padx=4)

        ttk.Label(top, text="Username").grid(row=0, column=2, sticky="w")
        ttk.Entry(top, textvariable=self.username_var).grid(row=0, column=3, sticky="ew", padx=4)

        ttk.Label(top, text="Password").grid(row=0, column=4, sticky="w")
        ttk.Entry(top, textvariable=self.password_var, show="*").grid(row=0, column=5, sticky="ew", padx=4)

        ttk.Button(top, text="Login", command=self.login).grid(row=0, column=6, padx=4)
        ttk.Button(top, text="Load Data", command=self.load_reference_data).grid(row=0, column=7, padx=4)
        ttk.Label(top, textvariable=self.status_var).grid(row=0, column=8, sticky="e")

        notebook = ttk.Notebook(self.root)
        notebook.grid(row=1, column=0, sticky="nsew")

        self.query_tab = ttk.Frame(notebook, padding=10)
        self.create_tab = ttk.Frame(notebook, padding=10)
        notebook.add(self.query_tab, text="View Quotes")
        notebook.add(self.create_tab, text="Create Quote")

        self._build_query_tab()
        self._build_create_tab()

    def _build_query_tab(self) -> None:
        self.query_tab.columnconfigure(0, weight=1)
        self.query_tab.rowconfigure(1, weight=1)
        self.query_tab.rowconfigure(2, weight=1)

        actions = ttk.Frame(self.query_tab)
        actions.grid(row=0, column=0, sticky="ew")
        actions.columnconfigure(3, weight=1)

        ttk.Button(actions, text="Refresh Quotes", command=self.refresh_quotes).grid(row=0, column=0, padx=4, pady=4)
        ttk.Button(actions, text="Open PDF", command=self.open_selected_pdf).grid(row=0, column=1, padx=4, pady=4)
        ttk.Button(actions, text="Open XLSX", command=self.open_selected_xlsx).grid(row=0, column=2, padx=4, pady=4)

        columns = ("quote_no", "status", "amount", "customer_id", "issue_date")
        self.quote_tree = ttk.Treeview(self.query_tab, columns=columns, show="headings", height=15)
        self.quote_tree.heading("quote_no", text="Quote No")
        self.quote_tree.heading("status", text="Status")
        self.quote_tree.heading("amount", text="Amount")
        self.quote_tree.heading("customer_id", text="Customer ID")
        self.quote_tree.heading("issue_date", text="Issue Date")

        self.quote_tree.column("quote_no", width=260)
        self.quote_tree.column("status", width=100)
        self.quote_tree.column("amount", width=120)
        self.quote_tree.column("customer_id", width=120)
        self.quote_tree.column("issue_date", width=120)
        self.quote_tree.grid(row=1, column=0, sticky="nsew", pady=6)
        self.quote_tree.bind("<<TreeviewSelect>>", self.on_quote_selected)

        self.detail_text = tk.Text(self.query_tab, height=14, wrap="word")
        self.detail_text.grid(row=2, column=0, sticky="nsew")
        self.detail_text.insert("1.0", "Select one quote to see details.")
        self.detail_text.configure(state="disabled")

    def _build_create_tab(self) -> None:
        self.create_tab.columnconfigure(1, weight=1)
        self.create_tab.columnconfigure(3, weight=1)
        self.create_tab.rowconfigure(7, weight=1)

        ttk.Label(self.create_tab, text="Customer").grid(row=0, column=0, sticky="w", pady=4)
        self.customer_combo = ttk.Combobox(self.create_tab, textvariable=self.customer_var, state="readonly")
        self.customer_combo.grid(row=0, column=1, sticky="ew", padx=4, pady=4)
        self.customer_combo.bind("<<ComboboxSelected>>", self.on_customer_changed)

        ttk.Label(self.create_tab, text="Contact").grid(row=0, column=2, sticky="w", pady=4)
        self.contact_combo = ttk.Combobox(self.create_tab, textvariable=self.contact_var, state="readonly")
        self.contact_combo.grid(row=0, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(self.create_tab, text="Issue Date").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(self.create_tab, textvariable=self.issue_date_var).grid(row=1, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(self.create_tab, text="Expiry Date").grid(row=1, column=2, sticky="w", pady=4)
        ttk.Entry(self.create_tab, textvariable=self.expiry_date_var).grid(row=1, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(self.create_tab, text="Currency").grid(row=2, column=0, sticky="w", pady=4)
        ttk.Entry(self.create_tab, textvariable=self.currency_var).grid(row=2, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(self.create_tab, text="Tax Rate (%)").grid(row=2, column=2, sticky="w", pady=4)
        ttk.Entry(self.create_tab, textvariable=self.tax_rate_var).grid(row=2, column=3, sticky="ew", padx=4, pady=4)

        ttk.Label(self.create_tab, text="Note").grid(row=3, column=0, sticky="nw", pady=4)
        self.note_entry = tk.Text(self.create_tab, height=3, wrap="word")
        self.note_entry.grid(row=3, column=1, columnspan=3, sticky="ew", padx=4, pady=4)

        helper = (
            "Items format: one line per item, separated by comma -> Description,Unit,Quantity,UnitPrice\n"
            "Example:\n"
            "Pipeline work,job,1,15000\n"
            "8P8C setup,job,1,5000"
        )
        ttk.Label(self.create_tab, text=helper, justify="left").grid(row=4, column=0, columnspan=4, sticky="w", pady=(8, 4))

        ttk.Label(self.create_tab, text="Items").grid(row=5, column=0, sticky="nw", pady=4)
        self.items_text = tk.Text(self.create_tab, height=12, wrap="none")
        self.items_text.grid(row=5, column=1, columnspan=3, sticky="nsew", padx=4, pady=4)

        self.create_tab.rowconfigure(5, weight=1)

        button_bar = ttk.Frame(self.create_tab)
        button_bar.grid(row=6, column=0, columnspan=4, sticky="e", pady=8)
        ttk.Button(button_bar, text="Create Quote", command=self.create_quote).grid(row=0, column=0, padx=4)

    def _ensure_login(self) -> bool:
        if self.api.token:
            return True
        messagebox.showerror("Not Logged In", "Please login first.")
        return False

    def login(self) -> None:
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        if not username or not password:
            messagebox.showerror("Input Error", "Username and password are required.")
            return

        try:
            self.api.set_base_url(self.base_url_var.get())
            payload = self.api.login(username, password)
        except APIError as exc:
            messagebox.showerror("Login Failed", str(exc))
            return

        user = payload.get("user") or {}
        role = user.get("role", "-")
        self.status_var.set(f"Logged in: {username} ({role})")
        self.load_reference_data()
        self.refresh_quotes()

    def load_reference_data(self) -> None:
        if not self._ensure_login():
            return
        try:
            self.customers = self.api.get_customers()
            self.contacts = self.api.get_contacts()
        except APIError as exc:
            messagebox.showerror("Load Error", str(exc))
            return
        self.populate_customer_options()
        self.on_customer_changed(None)

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
            messagebox.showerror("Load Quotes Failed", str(exc))
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

    def on_quote_selected(self, _event: Any) -> None:
        selected = self.quote_tree.selection()
        if not selected:
            return
        quote = self.quote_row_to_data.get(selected[0])
        if not quote:
            return

        self.detail_text.configure(state="normal")
        self.detail_text.delete("1.0", tk.END)
        self.detail_text.insert("1.0", json.dumps(quote, indent=2, ensure_ascii=False))
        self.detail_text.configure(state="disabled")

    def _selected_quote_id(self) -> int | None:
        selected = self.quote_tree.selection()
        if not selected:
            messagebox.showerror("No Selection", "Please select a quote.")
            return None
        quote = self.quote_row_to_data.get(selected[0])
        if not quote:
            messagebox.showerror("Selection Error", "Quote data not found.")
            return None
        quote_id = quote.get("id")
        if quote_id is None:
            messagebox.showerror("Selection Error", "Quote id is missing.")
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
        except APIError as exc:
            messagebox.showerror("PDF Error", str(exc))

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
        except APIError as exc:
            messagebox.showerror("XLSX Error", str(exc))

    def _save_temp_file(self, content: bytes, suffix: str, prefix: str) -> str:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=prefix) as temp_file:
            temp_file.write(content)
            return temp_file.name

    def _open_file(self, path: str) -> None:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=False)
            return
        subprocess.run(["xdg-open", path], check=False)

    def create_quote(self) -> None:
        if not self._ensure_login():
            return

        customer_label = self.customer_var.get()
        customer_id = self.customer_label_to_id.get(customer_label)
        if not customer_id:
            messagebox.showerror("Input Error", "Please select customer.")
            return

        contact_id = self.contact_label_to_id.get(self.contact_var.get())
        note = self.note_entry.get("1.0", tk.END).strip()

        try:
            tax_rate = float((self.tax_rate_var.get() or "0").strip())
        except ValueError:
            messagebox.showerror("Input Error", "Tax rate must be a number.")
            return

        raw_items = self.items_text.get("1.0", tk.END)
        try:
            items = self._parse_items(raw_items)
        except APIError as exc:
            messagebox.showerror("Items Error", str(exc))
            return

        payload: dict[str, Any] = {
            "customer_id": customer_id,
            "contact_id": contact_id,
            "issue_date": self.issue_date_var.get().strip() or None,
            "expiry_date": self.expiry_date_var.get().strip() or None,
            "currency": (self.currency_var.get() or "TWD").strip().upper(),
            "tax_rate": tax_rate,
            "note": note,
            "items": items,
        }

        # Backend accepts null for optional date/contact.
        if not payload["issue_date"]:
            payload["issue_date"] = None
        if not payload["expiry_date"]:
            payload["expiry_date"] = None
        if not payload["contact_id"]:
            payload["contact_id"] = None

        try:
            quote = self.api.create_quote(payload)
        except APIError as exc:
            messagebox.showerror("Create Quote Failed", str(exc))
            return

        quote_no = quote.get("quote_no", "(no quote no)")
        messagebox.showinfo("Success", f"Quote created: {quote_no}")
        self.refresh_quotes()

    def _parse_items(self, raw_text: str) -> list[dict[str, Any]]:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            raise APIError("Please input at least one item line.")

        items: list[dict[str, Any]] = []
        for idx, line in enumerate(lines, start=1):
            parts = [p.strip() for p in line.split(",")]
            if len(parts) != 4:
                raise APIError(
                    f"Line {idx} format error. Use: Description,Unit,Quantity,UnitPrice"
                )
            description, unit, quantity_text, unit_price_text = parts
            if not description:
                raise APIError(f"Line {idx}: description is required.")
            try:
                quantity = float(quantity_text)
                unit_price = float(unit_price_text)
            except ValueError as exc:
                raise APIError(f"Line {idx}: quantity/unit_price must be number.") from exc

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
    app = DesktopQuoteTool(root)
    root.mainloop()


if __name__ == "__main__":
    main()
