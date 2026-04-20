import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import { useRef } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import SignaturePad from '../components/task/SignaturePad.jsx';

let lineItemKeySeed = 1;
const nextLineItemKey = () => `line-${lineItemKeySeed++}`;
const blankItem = () => ({ _key: nextLineItemKey(), description: '', unit: '式', note: '', quantity: 1, unit_price: 0 });
const blankMarkerItem = () => ({ _key: nextLineItemKey(), description: '以下空白', unit: '', quantity: 0, unit_price: 0 });
const withLineItemKey = (item = {}) => ({ _key: nextLineItemKey(), ...item });
const quoteDisplayAmount = (quote) => Number(quote?.total_amount ?? quote?.subtotal ?? 0).toFixed(2);
const DEFAULT_QUOTE_VALID_DAYS = 10;
const MANUAL_TAX_ITEM_NAME = '稅金';
const MANUAL_TAX_RATE = 0.05;
const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};
const round2 = (value) => Math.round(toNumber(value) * 100) / 100;
const isBlankMarkerItem = (item) => String(item?.description || '').trim() === '以下空白';
const isManualTaxItem = (item) => String(item?.description || '').trim() === MANUAL_TAX_ITEM_NAME;
const calculateManualTaxSubtotal = (items) =>
  items.reduce((sum, item) => {
    if (isBlankMarkerItem(item) || isManualTaxItem(item)) return sum;
    return sum + toNumber(item?.quantity) * toNumber(item?.unit_price);
  }, 0);
const syncManualTaxItems = (items) => {
  if (!Array.isArray(items) || !items.some(isManualTaxItem)) return items;
  const taxAmount = round2(calculateManualTaxSubtotal(items) * MANUAL_TAX_RATE);
  return items.map((item) =>
    isManualTaxItem(item)
      ? {
          ...item,
          unit: '式',
          quantity: 1,
          unit_price: taxAmount,
        }
      : item,
  );
};
const STATUS_LABELS = {
  quote: {
    draft: '尚未送出',
    sent: '已送出',
    accepted: '已接受',
    rejected: '已拒絕',
    expired: '已過期',
  },
  invoice: {
    draft: '尚未請款',
    issued: '已請款',
    partially_paid: '部分收款',
    paid: '已收款',
    cancelled: '已取消',
  },
};
const crmStatusLabel = (type, status) => {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return '-';
  return STATUS_LABELS?.[type]?.[raw] || raw;
};
const formatListDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw.includes('T') ? raw.slice(0, 10) : raw;
};
const toDateInputValue = (value) => value.toISOString().slice(0, 10);
const addDaysToDateInput = (dateInput, days) => {
  if (!dateInput) return '';
  const dateValue = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return '';
  dateValue.setDate(dateValue.getDate() + days);
  return toDateInputValue(dateValue);
};
const getDateDiffDays = (startDateInput, endDateInput) => {
  if (!startDateInput || !endDateInput) return '';
  const startDate = new Date(`${startDateInput}T00:00:00`);
  const endDate = new Date(`${endDateInput}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '';
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
};
const defaultQuoteDateFields = () => {
  const today = new Date();
  const issue_date = toDateInputValue(today);
  const quote_valid_days = DEFAULT_QUOTE_VALID_DAYS;
  const expiry_date = addDaysToDateInput(issue_date, quote_valid_days);
  return { issue_date, expiry_date, quote_valid_days };
};
const todayDateValue = () => new Date().toISOString().slice(0, 10);
const defaultInvoicePaymentForm = (invoice) => ({
  payment_date: todayDateValue(),
  amount:
    invoice && Number(invoice.outstanding_amount || 0) > 0
      ? Number(invoice.outstanding_amount || 0).toFixed(2)
      : '',
  method: '',
  note: '',
});
const CRM_LIST_LIMIT_OPTIONS = [
  { value: '5', label: '最新 5 筆' },
  { value: '10', label: '最新 10 筆' },
  { value: '25', label: '最新 25 筆' },
  { value: '50', label: '最新 50 筆' },
  { value: '100', label: '最新 100 筆' },
  { value: '200', label: '最新 200 筆' },
  { value: 'all', label: '全部' },
];
const getFilenameFromDisposition = (contentDisposition) => {
  if (!contentDisposition) return '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (err) {
      return utf8Match[1];
    }
  }
  const basicMatch = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition);
  return basicMatch?.[1] || '';
};
const withAuthToken = (rawUrl) => {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('/api/upload/files/')) return url;
  const token = localStorage.getItem('auth_token');
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
};

const CrmQuotesPage = () => {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [history, setHistory] = useState({ quotes: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [convertingQuoteId, setConvertingQuoteId] = useState(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState(null);
  const [cancellingInvoiceId, setCancellingInvoiceId] = useState(null);
  const [paymentPanelInvoiceId, setPaymentPanelInvoiceId] = useState(null);
  const [savingInvoicePayment, setSavingInvoicePayment] = useState(false);
  const [deletingInvoicePaymentId, setDeletingInvoicePaymentId] = useState(null);
  const [invoiceSignatureName, setInvoiceSignatureName] = useState('');
  const [uploadingInvoiceSignature, setUploadingInvoiceSignature] = useState(false);
  const [error, setError] = useState('');
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [versionsForQuoteId, setVersionsForQuoteId] = useState(null);
  const [quoteVersions, setQuoteVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [catalogPick, setCatalogPick] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [specialItemType, setSpecialItemType] = useState('blank');
  const [listLimit, setListLimit] = useState('10');
  const [invoicePaymentForm, setInvoicePaymentForm] = useState(() => defaultInvoicePaymentForm(null));
  const invoiceSignatureSectionRef = useRef(null);

  const [form, setForm] = useState(() => ({
    customer_id: '',
    contact_id: '',
    recipient_name: '',
    site_address: '',
    ...defaultQuoteDateFields(),
    currency: 'TWD',
    tax_rate: 0,
    note: '',
  }));
  const [items, setItems] = useState([blankItem()]);
  const updateItems = (updater) => {
    setItems((prev) => {
      const nextItems = typeof updater === 'function' ? updater(prev) : updater;
      return syncManualTaxItems(nextItems);
    });
  };

  const loadBase = async () => {
    const [customerRes, contactRes, catalogRes] = await Promise.all([
      api.get('crm/customers'),
      api.get('crm/contacts'),
      api.get('crm/catalog-items'),
    ]);
    setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
    setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
    setCatalogItems(Array.isArray(catalogRes.data) ? catalogRes.data : []);
  };

  const loadQuotes = async () => {
    const { data } = await api.get('crm/quotes', { params: { limit: listLimit } });
    setQuotes(Array.isArray(data) ? data : []);
  };

  const loadInvoices = async () => {
    const { data } = await api.get('crm/invoices', { params: { limit: listLimit } });
    setInvoices(Array.isArray(data) ? data : []);
  };

  const loadHistory = async (customerId) => {
    if (!customerId) {
      setHistory({ quotes: [] });
      return;
    }
    const { data } = await api.get(`crm/customers/${customerId}/service-history`);
    setHistory({
      quotes: Array.isArray(data?.quotes) ? data.quotes : [],
    });
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError('');
      try {
        await loadBase();
      } catch (err) {
        setError(err?.networkMessage || err?.response?.data?.msg || '報價資料載入失敗');
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    const reloadLists = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([loadQuotes(), loadInvoices()]);
      } catch (err) {
        setError(err?.networkMessage || err?.response?.data?.msg || '報價資料載入失敗');
      } finally {
        setLoading(false);
      }
    };
    reloadLists();
  }, [listLimit]);

  useEffect(() => {
    if (form.customer_id) {
      loadHistory(form.customer_id).catch(() => null);
    } else {
      setHistory({ quotes: [] });
    }
  }, [form.customer_id]);

  useEffect(() => {
    if (!paymentPanelInvoiceId || !invoiceSignatureSectionRef.current) return;
    invoiceSignatureSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [paymentPanelInvoiceId]);

  const contactOptions = useMemo(
    () => contacts.filter((contact) => String(contact.customer_id) === String(form.customer_id)),
    [contacts, form.customer_id],
  );
  const filteredCatalogItems = useMemo(() => {
    const normalizedQuery = (catalogQuery || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return catalogItems.slice(0, 30);
    }
    return catalogItems
      .filter((item) => {
        const haystack = `${item.name || ''} ${item.unit || ''} ${item.note || ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 30);
  }, [catalogItems, catalogQuery]);
  const invoiceByQuoteId = useMemo(() => {
    const mapping = new Map();
    invoices.forEach((invoice) => {
      const status = String(invoice?.status || '').trim().toLowerCase();
      if (status === 'cancelled') return;
      const quoteId = Number(invoice?.quote_id || 0);
      if (!quoteId || mapping.has(quoteId)) return;
      mapping.set(quoteId, invoice);
    });
    return mapping;
  }, [invoices]);
  const activeInvoices = useMemo(
    () => invoices.filter((invoice) => String(invoice?.status || '').trim().toLowerCase() !== 'cancelled'),
    [invoices],
  );
  const listLimitLabel = useMemo(
    () => CRM_LIST_LIMIT_OPTIONS.find((option) => option.value === String(listLimit))?.label || '最新 10 筆',
    [listLimit],
  );
  const paymentPanelInvoice = useMemo(
    () => activeInvoices.find((invoice) => Number(invoice.id) === Number(paymentPanelInvoiceId)) || null,
    [activeInvoices, paymentPanelInvoiceId],
  );
  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [String(customer.id), customer])),
    [customers],
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    if (name === 'customer_id') {
      const selectedCustomer = customers.find((customer) => String(customer.id) === String(value));
      setForm((prev) => ({
        ...prev,
        customer_id: value,
        contact_id: '',
        recipient_name: selectedCustomer?.name || prev.recipient_name || '',
      }));
      return;
    }
    if (name === 'contact_id') {
      const selectedContact = contacts.find((contact) => String(contact.id) === String(value));
      setForm((prev) => ({
        ...prev,
        contact_id: value,
        recipient_name: selectedContact?.name || prev.recipient_name,
      }));
      return;
    }
    if (name === 'issue_date') {
      setForm((prev) => {
        const validDays = Math.max(0, Number(prev.quote_valid_days || 0));
        const nextAutoExpiry = addDaysToDateInput(value, validDays);
        return {
          ...prev,
          issue_date: value,
          expiry_date: nextAutoExpiry,
        };
      });
      return;
    }
    if (name === 'quote_valid_days') {
      setForm((prev) => {
        const validDays = Math.max(0, Number(value || 0));
        return {
          ...prev,
          quote_valid_days: value,
          expiry_date: prev.issue_date ? addDaysToDateInput(prev.issue_date, validDays) : prev.expiry_date,
        };
      });
      return;
    }
    if (name === 'expiry_date') {
      setForm((prev) => ({
        ...prev,
        expiry_date: value,
        quote_valid_days: prev.issue_date && value ? String(getDateDiffDays(prev.issue_date, value)) : prev.quote_valid_days,
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    updateItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
  };

  const resetForm = () => {
    setForm({
      customer_id: '',
      contact_id: '',
      recipient_name: '',
      site_address: '',
      ...defaultQuoteDateFields(),
      currency: 'TWD',
      tax_rate: 0,
      note: '',
    });
    setItems([blankItem()]);
    setHistory({ quotes: [] });
    setCatalogPick('');
    setCatalogQuery('');
    setCatalogOpen(false);
    setSpecialItemType('blank');
    setEditingQuoteId(null);
    setVersionsForQuoteId(null);
    setQuoteVersions([]);
  };

  const addItem = () => updateItems((prev) => [...prev, blankItem()]);

  const removeItem = (index) => {
    updateItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [blankItem()];
    });
  };
  const moveItem = (index, direction) => {
    updateItems((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const addFromCatalog = () => {
    if (!catalogPick) return;
    const selected = catalogItems.find((item) => String(item.id) === String(catalogPick));
    if (!selected) return;
    updateItems((prev) => [
      ...prev,
      {
        _key: nextLineItemKey(),
        description: selected.name || '',
        unit: selected.unit || '式',
        note: '',
        quantity: 1,
        unit_price: Number(selected.unit_price || 0),
      },
    ]);
    setCatalogPick('');
    setCatalogQuery('');
    setCatalogOpen(false);
  };
  const chooseCatalogItem = (item) => {
    setCatalogPick(String(item.id));
    setCatalogQuery(item.name || '');
    setCatalogOpen(true);
  };

  const addSpecialItem = () => {
    if (specialItemType === 'blank') {
      updateItems((prev) => [...prev, blankMarkerItem()]);
      return;
    }
    if (specialItemType === 'tax') {
      const taxRate = toNumber(form.tax_rate);
      if (taxRate > 0) {
        setError('已設定稅率，PDF 會自動產生稅金列，不需手動加入。');
        return;
      }
      if (items.some(isManualTaxItem)) {
        setError('已經有稅金品項，後續會自動重算，不需重複加入。');
        return;
      }
      updateItems((prev) => [
        ...prev,
        {
          _key: nextLineItemKey(),
          description: MANUAL_TAX_ITEM_NAME,
          unit: '式',
          note: '',
          quantity: 1,
          unit_price: 0,
        },
      ]);
      return;
    }
  };

  const loadQuoteVersions = async (quoteId) => {
    if (!quoteId) return;
    setVersionsLoading(true);
    setError('');
    try {
      const { data } = await api.get(`crm/quotes/${quoteId}/versions`);
      setQuoteVersions(Array.isArray(data?.versions) ? data.versions : []);
      setVersionsForQuoteId(quoteId);
    } catch (err) {
      setError(err?.response?.data?.msg || '載入版本紀錄失敗');
    } finally {
      setVersionsLoading(false);
    }
  };

  const startEditQuote = (quote) => {
    setError('');
    setEditingQuoteId(quote.id);
    setForm({
      customer_id: quote.customer_id ? String(quote.customer_id) : '',
      contact_id: quote.contact_id ? String(quote.contact_id) : '',
      recipient_name: quote.recipient_name || '',
      site_address: quote.site_address || '',
      issue_date: quote.issue_date || '',
      expiry_date: quote.expiry_date || '',
      quote_valid_days: String(getDateDiffDays(quote.issue_date || '', quote.expiry_date || '') || DEFAULT_QUOTE_VALID_DAYS),
      currency: quote.currency || 'TWD',
      tax_rate: Number(quote.tax_rate || 0),
      note: quote.note || '',
    });
    updateItems(
      Array.isArray(quote.items) && quote.items.length > 0
        ? quote.items.map((item) =>
            withLineItemKey({
              description: item.description || '',
              unit: item.unit || '式',
              note: item.note || '',
              quantity: item.quantity ?? 1,
              unit_price: item.unit_price ?? 0,
            }),
          )
        : [blankItem()],
    );
    if (quote.customer_id) {
      loadHistory(quote.customer_id).catch(() => null);
    }
    loadQuoteVersions(quote.id).catch(() => null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitQuote = async (event) => {
    event.preventDefault();
    if (!form.customer_id) {
      setError('請先選擇客戶');
      return;
    }

    const validItems = items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError('請至少填寫一個品項');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { quote_valid_days, ...payloadForm } = form;
      const payload = {
        ...payloadForm,
        customer_id: Number(form.customer_id),
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        recipient_name: (form.recipient_name || '').trim() || null,
        tax_rate: Number(form.tax_rate || 0),
        items: validItems.map((item) => ({
          description: item.description.trim(),
          unit: (item.unit || '式').trim(),
          note: (item.note || '').trim() || null,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
        })),
      };
      if (editingQuoteId) {
        await api.put(`crm/quotes/${editingQuoteId}`, payload);
      } else {
        await api.post('crm/quotes', payload);
      }

      resetForm();
      await Promise.all([loadQuotes(), loadBase()]);
    } catch (err) {
      setError(err?.response?.data?.msg || (editingQuoteId ? '更新報價失敗' : '新增報價失敗'));
    } finally {
      setSaving(false);
    }
  };

  const openPdf = async (quoteId) => {
    try {
      const response = await api.get(`crm/quotes/${quoteId}/pdf`, { responseType: 'blob' });
      const data = response.data;
      const filenameFromHeader = getFilenameFromDisposition(response.headers?.['content-disposition']);
      const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filenameFromHeader || `quote-${quoteId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      const blobPayload = err?.response?.data;
      if (typeof Blob !== 'undefined' && blobPayload instanceof Blob) {
        try {
          const text = await blobPayload.text();
          const parsed = JSON.parse(text);
          const fontHealth = parsed?.font_health || {};
          const fontSummary = [fontHealth?.font_source, fontHealth?.discovered_font_path]
            .filter(Boolean)
            .join(' @ ');
          const detail = [parsed?.msg, parsed?.detail, fontSummary].filter(Boolean).join(' / ');
          setError(detail || '開啟 PDF 失敗');
          return;
        } catch {
          // Fall through to generic error handling.
        }
      }
      setError(err?.networkMessage || err?.response?.data?.msg || '下載 PDF 失敗');
    }
  };

  const openInvoicePdf = async (invoiceId) => {
    try {
      const response = await api.get(`crm/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const data = response.data;
      const filenameFromHeader = getFilenameFromDisposition(response.headers?.['content-disposition']);
      const blobUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filenameFromHeader || `invoice-${invoiceId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      const blobPayload = err?.response?.data;
      if (typeof Blob !== 'undefined' && blobPayload instanceof Blob) {
        try {
          const text = await blobPayload.text();
          const parsed = JSON.parse(text);
          const fontHealth = parsed?.font_health || {};
          const fontSummary = [fontHealth?.font_source, fontHealth?.discovered_font_path]
            .filter(Boolean)
            .join(' @ ');
          const detail = [parsed?.msg, parsed?.detail, fontSummary].filter(Boolean).join(' / ');
          setError(detail || '開啟請款單 PDF 失敗');
          return;
        } catch {
          // Fall through to generic error handling.
        }
      }
      setError(err?.networkMessage || err?.response?.data?.msg || '下載請款單 PDF 失敗');
    }
  };

  const downloadXlsx = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    try {
      const response = await api.get(`crm/quotes/${quoteId}/xlsx`, { responseType: 'blob' });
      const data = response.data;
      const filenameFromHeader = getFilenameFromDisposition(response.headers?.['content-disposition']);
      const blobUrl = URL.createObjectURL(
        new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      );
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filenameFromHeader || `${quote?.customer_name || 'customer'}-${quote?.quote_no || quoteId}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '下載估價單失敗');
    }
  };

  const convertQuoteToInvoice = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    setConvertingQuoteId(quoteId);
    setError('');
    try {
      await api.post(`crm/quotes/${quoteId}/convert-to-invoice`);
      await loadInvoices();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '轉成請款單失敗');
    } finally {
      setConvertingQuoteId(null);
    }
  };

  const deleteQuote = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    const quoteLabel = quote?.quote_no || `#${quoteId}`;
    const confirmed = window.confirm(`確定要刪除報價單 ${quoteLabel} 嗎？此操作無法復原。`);
    if (!confirmed) return;
    setDeletingQuoteId(quoteId);
    setError('');
    try {
      await api.delete(`crm/quotes/${quoteId}`);
      if (editingQuoteId === quoteId) {
        resetForm();
      }
      await loadQuotes();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '刪除報價單失敗');
    } finally {
      setDeletingQuoteId(null);
    }
  };

  const cancelInvoice = async (invoice) => {
    const invoiceId = Number(invoice?.id || 0);
    if (!invoiceId || (invoice?.status || '').toLowerCase() === 'cancelled') return;
    setCancellingInvoiceId(invoiceId);
    setError('');
    try {
      await api.put(`crm/invoices/${invoiceId}`, { status: 'cancelled' });
      await loadInvoices();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '取消請款失敗');
    } finally {
      setCancellingInvoiceId(null);
    }
  };

  const openInvoicePaymentPanel = (invoice) => {
    const invoiceId = Number(invoice?.id || 0);
    if (!invoiceId) return;
    setPaymentPanelInvoiceId(invoiceId);
    setInvoicePaymentForm(defaultInvoicePaymentForm(invoice));
    setInvoiceSignatureName(invoice?.customer_signature_name || invoice?.contact_name || invoice?.customer_name || '');
    setError('');
  };

  const handleInvoicePaymentChange = (event) => {
    const { name, value } = event.target;
    setInvoicePaymentForm((prev) => ({ ...prev, [name]: value }));
  };

  const submitInvoicePayment = async (event) => {
    event.preventDefault();
    const invoiceId = Number(paymentPanelInvoice?.id || 0);
    if (!invoiceId) {
      setError('請先選擇請款單');
      return;
    }
    if (!invoicePaymentForm.amount || Number(invoicePaymentForm.amount) <= 0) {
      setError('請輸入正確收款金額');
      return;
    }

    setSavingInvoicePayment(true);
    setError('');
    try {
      const { data } = await api.post(`crm/invoices/${invoiceId}/payments`, {
        payment_date: invoicePaymentForm.payment_date || null,
        amount: Number(invoicePaymentForm.amount),
        method: (invoicePaymentForm.method || '').trim() || null,
        note: (invoicePaymentForm.note || '').trim() || null,
      });
      await loadInvoices();
      setInvoicePaymentForm(defaultInvoicePaymentForm(data?.invoice || paymentPanelInvoice));
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '新增收款紀錄失敗');
    } finally {
      setSavingInvoicePayment(false);
    }
  };

  const deleteInvoicePayment = async (invoice, payment) => {
    const invoiceId = Number(invoice?.id || 0);
    const paymentId = Number(payment?.id || 0);
    if (!invoiceId || !paymentId) return;
    if (!window.confirm('確定要刪除這筆收款紀錄嗎？')) return;
    setDeletingInvoicePaymentId(paymentId);
    setError('');
    try {
      await api.delete(`crm/invoices/${invoiceId}/payments/${paymentId}`);
      await loadInvoices();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '刪除收款紀錄失敗');
    } finally {
      setDeletingInvoicePaymentId(null);
    }
  };

  const submitInvoiceSignature = async (dataUrl) => {
    const invoiceId = Number(paymentPanelInvoice?.id || 0);
    if (!invoiceId) {
      setError('請先選擇請款單');
      return;
    }
    if (!dataUrl) return;

    setUploadingInvoiceSignature(true);
    setError('');
    try {
      await api.post(`crm/invoices/${invoiceId}/signature`, {
        data_url: dataUrl,
        signature_name: (invoiceSignatureName || '').trim() || null,
      });
      await loadInvoices();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '客戶簽名儲存失敗');
    } finally {
      setUploadingInvoiceSignature(false);
    }
  };

  return (
    <div className="page">
      <AppHeader title="報價單" subtitle="可從價目資料庫帶入品項，並查看客戶歷史施工紀錄。" />

      {error && <p className="error-text">{error}</p>}

      <section className="panel">
        <h2>新增報價單</h2>
        {editingQuoteId ? <div className="panel-tag">編輯中：#{editingQuoteId}</div> : null}
        <form className="stack" onSubmit={submitQuote}>
          <div className="crm-form-grid">
            <label>
              客戶
              <select name="customer_id" value={form.customer_id} onChange={handleChange}>
                <option value="">請選擇客戶</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              聯絡人
              <select name="contact_id" value={form.contact_id} onChange={handleChange}>
                <option value="">請選擇聯絡人</option>
                {contactOptions.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              台照顯示名稱
              <input
                name="recipient_name"
                value={form.recipient_name}
                onChange={handleChange}
                list="crm-recipient-options"
                placeholder="可選客戶或聯絡人"
              />
              <datalist id="crm-recipient-options">
                {customers.map((customer) => (
                  <option key={`recipient-c-${customer.id}`} value={customer.name} />
                ))}
                {contactOptions.map((contact) => (
                  <option key={`recipient-p-${contact.id}`} value={contact.name} />
                ))}
              </datalist>
            </label>
            <label>
              施工地點
              <input
                name="site_address"
                value={form.site_address}
                onChange={handleChange}
                placeholder="填寫施工地址或地點名稱"
              />
            </label>
            <label>
              報價日期
              <input type="date" name="issue_date" value={form.issue_date} onChange={handleChange} />
            </label>
            <label>
              有效天數
              <input
                type="number"
                min="0"
                name="quote_valid_days"
                value={form.quote_valid_days}
                onChange={handleChange}
              />
            </label>
            <label>
              有效日期
              <input type="date" name="expiry_date" value={form.expiry_date} onChange={handleChange} />
            </label>
            <label>
              稅率 (%)
              <input type="number" name="tax_rate" value={form.tax_rate} onChange={handleChange} step="0.1" />
            </label>
            <label>
              幣別
              <input name="currency" value={form.currency} onChange={handleChange} />
            </label>
            <label className="crm-span-2">
              備註
              <textarea name="note" value={form.note} onChange={handleChange} />
            </label>
          </div>

          <div className="crm-line-items">
            <div className="panel-header">
              <h3>品項</h3>
              <div className="crm-line-tools">
                <div className="crm-catalog-picker">
                  <input
                    value={catalogQuery}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCatalogQuery(next);
                      setCatalogOpen(true);
                      if (!next.trim()) {
                        setCatalogPick('');
                      }
                    }}
                    onFocus={() => setCatalogOpen(true)}
                    onBlur={() => window.setTimeout(() => setCatalogOpen(false), 120)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (filteredCatalogItems[0]) {
                          chooseCatalogItem(filteredCatalogItems[0]);
                        }
                      }
                    }}
                    placeholder="搜尋價目資料庫（例：網）"
                  />
                  {catalogOpen ? (
                    <div className="crm-catalog-results">
                      {filteredCatalogItems.length > 0 ? (
                        filteredCatalogItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`crm-catalog-option ${String(item.id) === String(catalogPick) ? 'is-active' : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseCatalogItem(item)}
                          >
                            <span>{item.name}</span>
                            <small>{item.unit || '式'} / {Number(item.unit_price || 0).toFixed(0)}</small>
                          </button>
                        ))
                      ) : (
                        <div className="crm-catalog-empty">找不到符合的品項</div>
                      )}
                    </div>
                  ) : null}
                </div>
                <button type="button" className="secondary-btn" onClick={addFromCatalog} disabled={!catalogPick}>
                  帶入品項
                </button>
                <button type="button" className="secondary-btn" onClick={addItem}>
                  新增一列
                </button>
                <select value={specialItemType} onChange={(event) => setSpecialItemType(event.target.value)}>
                  <option value="blank">空白行</option>
                  <option value="tax">稅金（5%預設）</option>
                </select>
                <button type="button" className="secondary-btn" onClick={addSpecialItem}>
                  加入特殊項
                </button>
              </div>
            </div>

            {items.map((item, idx) => (
              <div key={item._key || idx} className="crm-line-item">
                <input
                  value={item.description}
                  onChange={(event) => handleItemChange(idx, 'description', event.target.value)}
                  placeholder="項目名稱"
                />
                <input
                  value={item.unit}
                  onChange={(event) => handleItemChange(idx, 'unit', event.target.value)}
                  placeholder="單位"
                />
                <input
                  value={item.note || ''}
                  onChange={(event) => handleItemChange(idx, 'note', event.target.value)}
                  placeholder="備註"
                />
                <input
                  type="number"
                  value={item.quantity}
                  onChange={(event) => handleItemChange(idx, 'quantity', event.target.value)}
                  placeholder="數量"
                  step="0.1"
                  disabled={isManualTaxItem(item)}
                />
                <input
                  type="number"
                  value={item.unit_price}
                  onChange={(event) => handleItemChange(idx, 'unit_price', event.target.value)}
                  placeholder="單價"
                  step="0.1"
                  disabled={isManualTaxItem(item)}
                />
                <button type="button" className="secondary-btn" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>
                  上移
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => moveItem(idx, 1)}
                  disabled={idx === items.length - 1}
                >
                  下移
                </button>
                <button type="button" className="secondary-btn" onClick={() => removeItem(idx)}>
                  刪除
                </button>
              </div>
            ))}
          </div>

          <div className="crm-form-actions">
            {editingQuoteId ? (
              <button type="button" className="secondary-btn" onClick={resetForm} disabled={saving}>
                取消編輯
              </button>
            ) : null}
            <button type="submit" disabled={saving}>
              {saving ? '處理中...' : editingQuoteId ? '儲存報價單' : '建立報價單'}
            </button>
          </div>
        </form>
      </section>

      {versionsForQuoteId ? (
        <section className="panel panel--table">
          <div className="panel-header">
            <h2>報價版本紀錄</h2>
            <span className="panel-tag">報價單 #{versionsForQuoteId}</span>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>動作</th>
                  <th>時間</th>
                  <th>人員</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {quoteVersions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version_no}</td>
                    <td>{version.action || '-'}</td>
                    <td>{version.created_at || '-'}</td>
                    <td>{version.changed_by_username || '-'}</td>
                    <td>{version.summary || '-'}</td>
                  </tr>
                ))}
                {!versionsLoading && quoteVersions.length === 0 ? (
                  <tr>
                    <td colSpan="5">尚無版本紀錄</td>
                  </tr>
                ) : null}
                {versionsLoading ? (
                  <tr>
                    <td colSpan="5">載入中...</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>客戶歷史施工紀錄</h2>
          <span className="panel-tag">依目前選取客戶</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>類型</th>
                <th>單號</th>
                <th>日期</th>
                <th>第一項目</th>
                <th>金額</th>
              </tr>
            </thead>
            <tbody>
              {history.quotes.map((row) => (
                <tr key={`q-${row.id}`}>
                  <td>報價</td>
                  <td>{row.quote_no}</td>
                  <td>{row.issue_date || '-'}</td>
                  <td>{row.items?.[0]?.description || '-'}</td>
                  <td>{quoteDisplayAmount(row)}</td>
                </tr>
              ))}
              {history.quotes.length === 0 ? (
                <tr>
                  <td colSpan="5">選擇客戶後可查看歷史紀錄</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>報價單列表</h2>
          <label className="panel-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            顯示筆數
            <select value={listLimit} onChange={(event) => setListLimit(event.target.value || '10')}>
              {CRM_LIST_LIMIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>單號</th>
                <th>狀態</th>
                <th>金額</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id}>
                  <td>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <strong>{quote.quote_no || '-'}</strong>
                      <span style={{ fontSize: '0.92rem', color: '#5f6b7a' }}>
                        {(quote.customer_name || customerMap.get(String(quote.customer_id || ''))?.name || '-')}
                      </span>
                      <span style={{ fontSize: '0.86rem', color: '#7a8797' }}>
                        {formatListDate(quote.issue_date || quote.created_at)}
                      </span>
                    </div>
                  </td>
                  <td>{crmStatusLabel('quote', quote.status)}</td>
                  <td>{quoteDisplayAmount(quote)}</td>
                  <td className="crm-actions-cell">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => convertQuoteToInvoice(quote)}
                      disabled={convertingQuoteId === quote.id || invoiceByQuoteId.has(Number(quote.id))}
                    >
                      {convertingQuoteId === quote.id
                        ? '轉換中...'
                        : invoiceByQuoteId.has(Number(quote.id))
                          ? '已轉請款單'
                          : '轉成請款單'}
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => openPdf(quote.id)}>
                      PDF下載
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => downloadXlsx(quote)}>
                      XLSX
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => startEditQuote(quote)}>
                      編輯
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => deleteQuote(quote)}
                      disabled={deletingQuoteId === quote.id}
                    >
                      {deletingQuoteId === quote.id ? '刪除中...' : '刪除'}
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => loadQuoteVersions(quote.id)}>
                      版本
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && quotes.length === 0 ? (
                <tr>
                  <td colSpan="4">尚無報價單</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="4">載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>請款單列表</h2>
          <span className="panel-tag">同步顯示{listLimitLabel}</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>請款單號</th>
                <th>來源報價單</th>
                <th>客戶</th>
                <th>狀態</th>
                <th>金額</th>
                <th>日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {activeInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_no || '-'}</td>
                  <td>{invoice.quote_no || '-'}</td>
                  <td>{invoice.customer_name || '-'}</td>
                  <td>
                    <div className="crm-status-stack">
                      <span>{crmStatusLabel('invoice', invoice.status)}</span>
                      <span className={`signature-status-chip ${invoice.customer_signed_at ? 'is-signed' : 'is-pending'}`}>
                        {invoice.customer_signed_at ? '已簽名' : '未簽名'}
                      </span>
                    </div>
                  </td>
                  <td>{quoteDisplayAmount(invoice)}</td>
                  <td>{invoice.issue_date || '-'}</td>
                  <td className="crm-actions-cell">
                    <button type="button" className="secondary-btn" onClick={() => openInvoicePdf(invoice.id)}>
                      PDF下載
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => openInvoicePaymentPanel(invoice)}>
                      {invoice.customer_signed_at ? '查看簽名' : '客戶簽名'}
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => openInvoicePaymentPanel(invoice)}>
                      收款
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => cancelInvoice(invoice)}
                      disabled={cancellingInvoiceId === invoice.id || String(invoice.status || '').toLowerCase() === 'cancelled'}
                    >
                      {String(invoice.status || '').toLowerCase() === 'cancelled'
                        ? '已取消'
                        : cancellingInvoiceId === invoice.id
                          ? '取消中...'
                          : '取消請款'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && activeInvoices.length === 0 ? (
                <tr>
                  <td colSpan="7">尚無請款單</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="7">載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {paymentPanelInvoice ? (
        <section className="panel panel--table">
          <div className="panel-header">
            <h2>收款紀錄</h2>
            <div className="crm-actions-cell">
              <span className="panel-tag">{paymentPanelInvoice.invoice_no || '-'}</span>
              <button type="button" className="secondary-btn" onClick={() => setPaymentPanelInvoiceId(null)}>
                關閉
              </button>
            </div>
          </div>

          <div className="crm-form-grid" style={{ marginBottom: 12 }}>
            <div className="panel-tag">應收總額 NT$ {Number(paymentPanelInvoice.total_amount || 0).toFixed(2)}</div>
            <div className="panel-tag">已收 NT$ {Number(paymentPanelInvoice.payment_total || 0).toFixed(2)}</div>
            <div className="panel-tag">未收 NT$ {Number(paymentPanelInvoice.outstanding_amount || 0).toFixed(2)}</div>
            <div className="panel-tag">狀態：{crmStatusLabel('invoice', paymentPanelInvoice.status)}</div>
          </div>

          <section ref={invoiceSignatureSectionRef} className="invoice-signature-card">
            <div className="panel-header">
              <h3>客戶簽名</h3>
              <span className="panel-tag">
                {paymentPanelInvoice.customer_signed_at
                  ? `已簽名：${String(paymentPanelInvoice.customer_signed_at).replace('T', ' ').slice(0, 16)}`
                  : '尚未簽名'}
              </span>
            </div>
            <div className="crm-form-grid" style={{ marginBottom: 12 }}>
              <label>
                簽名人
                <input
                  name="invoice_signature_name"
                  value={invoiceSignatureName}
                  onChange={(event) => setInvoiceSignatureName(event.target.value)}
                  placeholder="例如：王小明"
                />
              </label>
            </div>
            {paymentPanelInvoice.customer_signature_url ? (
              <div className="invoice-signature-preview">
                <img src={withAuthToken(paymentPanelInvoice.customer_signature_url)} alt="客戶簽名" />
              </div>
            ) : null}
            <SignaturePad onSubmit={submitInvoiceSignature} disabled={uploadingInvoiceSignature} />
            {uploadingInvoiceSignature ? <p className="hint-text">簽名上傳中…</p> : null}
          </section>

          <form className="stack" onSubmit={submitInvoicePayment}>
            <div className="crm-form-grid">
              <label>
                收款日期
                <input
                  type="date"
                  name="payment_date"
                  value={invoicePaymentForm.payment_date}
                  onChange={handleInvoicePaymentChange}
                />
              </label>
              <label>
                收款金額
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="amount"
                  value={invoicePaymentForm.amount}
                  onChange={handleInvoicePaymentChange}
                  placeholder="請輸入收款金額"
                />
              </label>
              <label>
                收款方式
                <input
                  name="method"
                  value={invoicePaymentForm.method}
                  onChange={handleInvoicePaymentChange}
                  placeholder="現金 / 轉帳 / 支票"
                />
              </label>
              <label>
                備註
                <input
                  name="note"
                  value={invoicePaymentForm.note}
                  onChange={handleInvoicePaymentChange}
                  placeholder="例如：尾款、第一期款"
                />
              </label>
            </div>
            <div className="crm-form-actions">
              <button type="submit" disabled={savingInvoicePayment}>
                {savingInvoicePayment ? '登記中...' : '新增收款紀錄'}
              </button>
            </div>
          </form>

          <div className="table-wrapper" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>金額</th>
                  <th>方式</th>
                  <th>備註</th>
                  <th>登記人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(paymentPanelInvoice.payment_records) ? paymentPanelInvoice.payment_records : []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.payment_date || '-'}</td>
                    <td>{Number(row.amount || 0).toFixed(2)}</td>
                    <td>{row.method || '-'}</td>
                    <td>{row.note || '-'}</td>
                    <td>{row.received_by_username || '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => deleteInvoicePayment(paymentPanelInvoice, row)}
                        disabled={deletingInvoicePaymentId === row.id}
                      >
                        {deletingInvoicePaymentId === row.id ? '刪除中...' : '刪除'}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!Array.isArray(paymentPanelInvoice.payment_records) || paymentPanelInvoice.payment_records.length === 0) ? (
                  <tr>
                    <td colSpan="6">尚無收款紀錄</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default CrmQuotesPage;
