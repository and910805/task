import { useEffect, useMemo, useState } from 'react';

import api from '../api/client.js';
import { useCallback, useRef } from 'react';
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
const isBlankMarkerItem = (item) => String(item?.description || '').trim() === '以下空白';
const isManualTaxItem = (item) => String(item?.description || '').trim() === MANUAL_TAX_ITEM_NAME;
const calculateManualTaxSubtotal = (items) =>
  items.reduce((sum, item) => {
    if (isBlankMarkerItem(item) || isManualTaxItem(item)) return sum;
    return sum + toNumber(item?.quantity) * toNumber(item?.unit_price);
  }, 0);
const calculateManualTaxAmount = (items) => Math.ceil(calculateManualTaxSubtotal(items) * MANUAL_TAX_RATE);
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
  contract: {
    draft: '草稿',
    ready: '待簽署',
    signed: '已簽署',
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
const DEFAULT_CONTRACT_PAYMENT_TERMS = '簽約訂金 30%；工程進度款 40%；驗收完成後支付尾款 30%。';
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
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
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
  const [activeTab, setActiveTab] = useState('manage');
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [catalogItems, setCatalogItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [history, setHistory] = useState({ quotes: [] });
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [convertingQuoteId, setConvertingQuoteId] = useState(null);
  const [copyingQuoteId, setCopyingQuoteId] = useState(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState(null);
  const [downloadingQuotePdfId, setDownloadingQuotePdfId] = useState(null);
  const [downloadingContractPdfId, setDownloadingContractPdfId] = useState(null);
  const [pendingDeleteQuoteId, setPendingDeleteQuoteId] = useState(null);
  const [cancellingInvoiceId, setCancellingInvoiceId] = useState(null);
  const [downloadingInvoicePdfId, setDownloadingInvoicePdfId] = useState(null);
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
  const [contractForm, setContractForm] = useState(null);
  const [editingContractId, setEditingContractId] = useState(null);
  const [savingContract, setSavingContract] = useState(false);
  const [versionsForContractId, setVersionsForContractId] = useState(null);
  const [contractVersions, setContractVersions] = useState([]);
  const [contractVersionsLoading, setContractVersionsLoading] = useState(false);
  const contractFormOpenKey = contractForm
    ? `${editingContractId || 'new'}:${contractForm.quote_id || ''}`
    : '';
  const [catalogPick, setCatalogPick] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [specialItemType, setSpecialItemType] = useState('blank');
  const [listLimit, setListLimit] = useState('10');
  const [itemUsageCatalogId, setItemUsageCatalogId] = useState('');
  const [itemUsageKeyword, setItemUsageKeyword] = useState('');
  const [itemUsageLoading, setItemUsageLoading] = useState(false);
  const [itemUsageResults, setItemUsageResults] = useState([]);
  const [itemUsageMeta, setItemUsageMeta] = useState({ total_quotes: 0, total_matches: 0, criteria: {} });
  const [itemUsageSearched, setItemUsageSearched] = useState(false);
  const [invoicePaymentForm, setInvoicePaymentForm] = useState(() => defaultInvoicePaymentForm(null));
  const invoiceSignatureSectionRef = useRef(null);
  const invoiceListSectionRef = useRef(null);
  const contractFormSectionRef = useRef(null);

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
      return Array.isArray(nextItems) ? nextItems : prev;
    });
  };

  const loadBase = useCallback(async () => {
    const [customerRes, contactRes, catalogRes] = await Promise.all([
      api.get('crm/customers'),
      api.get('crm/contacts'),
      api.get('crm/catalog-items'),
    ]);
    setCustomers(Array.isArray(customerRes.data) ? customerRes.data : []);
    setContacts(Array.isArray(contactRes.data) ? contactRes.data : []);
    setCatalogItems(Array.isArray(catalogRes.data) ? catalogRes.data : []);
  }, []);

  const loadPageData = useCallback(async () => {
    const { data } = await api.get('crm/boot', { params: { limit: listLimit } });
    setCustomers(Array.isArray(data?.customers) ? data.customers : []);
    setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
    setCatalogItems(Array.isArray(data?.catalog_items) ? data.catalog_items : []);
    setQuotes(Array.isArray(data?.quotes) ? data.quotes : []);
    setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
    setContracts(Array.isArray(data?.contracts) ? data.contracts : []);
  }, [listLimit]);

  const loadQuotes = useCallback(async () => {
    const { data } = await api.get('crm/quotes', { params: { limit: listLimit } });
    const rows = Array.isArray(data) ? data : [];
    setQuotes(rows);
    return rows;
  }, [listLimit]);

  const loadInvoices = useCallback(async (quoteRows) => {
    const rows = Array.isArray(quoteRows) ? quoteRows : [];
    const quoteIds = rows
      .map((row) => Number(row?.id || 0))
      .filter((id) => id > 0);
    const params = { limit: listLimit };
    if (quoteIds.length > 0) {
      params.quote_ids = quoteIds.join(',');
      params.limit = 'all';
    }
    const { data } = await api.get('crm/invoices', { params });
    const invoiceRows = Array.isArray(data) ? data : [];
    setInvoices(invoiceRows);
    return invoiceRows;
  }, [listLimit]);

  const loadContracts = useCallback(async () => {
    const { data } = await api.get('crm/contracts');
    const rows = Array.isArray(data) ? data : [];
    setContracts(rows);
    return rows;
  }, []);

  const reloadManagedLists = useCallback(async () => {
    const quoteRows = await loadQuotes();
    await Promise.all([loadInvoices(quoteRows), loadContracts()]);
  }, [loadContracts, loadInvoices, loadQuotes]);

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

  const searchItemUsage = async () => {
    const keyword = itemUsageKeyword.trim();
    if (!itemUsageCatalogId && !keyword) {
      setError('請先選擇品項或輸入關鍵字');
      setItemUsageSearched(false);
      return;
    }
    setItemUsageLoading(true);
    setError('');
    try {
      const params = { limit: '100' };
      if (itemUsageCatalogId) params.catalog_item_id = itemUsageCatalogId;
      if (keyword) params.q = keyword;
      const { data } = await api.get('crm/quotes/item-usage', { params });
      setItemUsageResults(Array.isArray(data?.results) ? data.results : []);
      setItemUsageMeta({
        total_quotes: Number(data?.total_quotes || 0),
        total_matches: Number(data?.total_matches || 0),
        criteria: data?.criteria || {},
      });
      setItemUsageSearched(true);
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '查詢品項使用紀錄失敗');
      setItemUsageResults([]);
      setItemUsageMeta({ total_quotes: 0, total_matches: 0, criteria: {} });
      setItemUsageSearched(true);
    } finally {
      setItemUsageLoading(false);
    }
  };

  const resetItemUsageSearch = () => {
    setItemUsageCatalogId('');
    setItemUsageKeyword('');
    setItemUsageResults([]);
    setItemUsageMeta({ total_quotes: 0, total_matches: 0, criteria: {} });
    setItemUsageSearched(false);
    setError('');
  };

  useEffect(() => {
    let active = true;

    const reloadPage = async () => {
      setLoading(true);
      setError('');
      try {
        await loadPageData();
      } catch (err) {
        if (active) {
          setError(err?.networkMessage || err?.response?.data?.msg || '報價資料載入失敗，請按重新整理再試');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    reloadPage();
    return () => {
      active = false;
    };
  }, [loadPageData, reloadKey]);

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

  useEffect(() => {
    if (!contractFormOpenKey || !contractFormSectionRef.current) return;
    contractFormSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    contractFormSectionRef.current.focus({ preventScroll: true });
  }, [contractFormOpenKey]);

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
  const contractsByQuoteId = useMemo(() => {
    const mapping = new Map();
    contracts.forEach((contract) => {
      const quoteId = Number(contract?.quote_id || 0);
      if (!quoteId) return;
      const rows = mapping.get(quoteId) || [];
      rows.push(contract);
      mapping.set(quoteId, rows);
    });
    return mapping;
  }, [contracts]);
  const activeInvoices = useMemo(
    () => invoices.filter((invoice) => String(invoice?.status || '').trim().toLowerCase() !== 'cancelled'),
    [invoices],
  );
  const paymentPanelInvoice = useMemo(
    () => activeInvoices.find((invoice) => Number(invoice.id) === Number(paymentPanelInvoiceId)) || null,
    [activeInvoices, paymentPanelInvoiceId],
  );
  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [String(customer.id), customer])),
    [customers],
  );
  const selectedUsageCatalogItem = useMemo(
    () => catalogItems.find((item) => String(item.id) === String(itemUsageCatalogId)) || null,
    [catalogItems, itemUsageCatalogId],
  );
  const getActiveInvoiceForQuote = (quote) => {
    const quoteInvoiceStatus = String(quote?.active_invoice?.status || '').trim().toLowerCase();
    if (quote?.active_invoice?.id && quoteInvoiceStatus !== 'cancelled') {
      return quote.active_invoice;
    }
    return invoiceByQuoteId.get(Number(quote?.id || 0)) || null;
  };

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
    setPendingDeleteQuoteId(null);
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
        setError('已經有稅金品項，可直接修改既有稅金金額，不需重複加入。');
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
          unit_price: calculateManualTaxAmount(prev),
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
              unit_price: isManualTaxItem(item) ? Math.ceil(toNumber(item.unit_price)) : item.unit_price ?? 0,
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
      const payloadForm = { ...form };
      delete payloadForm.quote_valid_days;
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
      await Promise.all([reloadManagedLists(), loadBase()]);
    } catch (err) {
      setError(err?.response?.data?.msg || (editingQuoteId ? '更新報價失敗' : '新增報價失敗'));
    } finally {
      setSaving(false);
    }
  };

  const openContractEditor = (quote, contract = null) => {
    const customer = customerMap.get(String(quote?.customer_id || '')) || {};
    setEditingContractId(contract?.id || null);
    setContractForm({
      quote_id: Number(contract?.quote_id || quote?.id || 0),
      quote_no: quote?.quote_no || contract?.quote_no || '',
      contract_date: contract?.contract_date || todayDateValue(),
      status: contract?.status || 'draft',
      project_name: contract?.project_name || `${quote?.customer_name || customer.name || quote?.quote_no || '客戶'} 水電工程`,
      site_address: contract?.site_address || quote?.site_address || customer.address || '',
      party_a_name: contract?.party_a_name || quote?.recipient_name || quote?.customer_name || customer.name || '',
      party_a_tax_id: contract?.party_a_tax_id || customer.tax_id || '',
      party_a_phone: contract?.party_a_phone || customer.phone || '',
      party_a_address: contract?.party_a_address || customer.address || '',
      party_b_name: contract?.party_b_name || '立翔水電行',
      party_b_tax_id: contract?.party_b_tax_id || '14511159',
      party_b_phone: contract?.party_b_phone || '',
      party_b_address: contract?.party_b_address || '',
      start_date: contract?.start_date || '',
      end_date: contract?.end_date || '',
      payment_terms: contract?.payment_terms || DEFAULT_CONTRACT_PAYMENT_TERMS,
      warranty_months: contract?.warranty_months ?? 12,
      special_terms: contract?.special_terms || '',
      version_summary: '',
    });
  };

  const saveContract = async (event) => {
    event.preventDefault();
    if (!contractForm?.quote_id) return;
    setSavingContract(true);
    setError('');
    try {
      const payload = { ...contractForm, warranty_months: Number(contractForm.warranty_months || 0) };
      if (editingContractId) {
        await api.put(`crm/contracts/${editingContractId}`, payload);
      } else {
        await api.post(`crm/quotes/${contractForm.quote_id}/contracts`, payload);
      }
      setContractForm(null);
      setEditingContractId(null);
      await loadContracts();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '儲存工程契約失敗');
    } finally {
      setSavingContract(false);
    }
  };

  const loadContractVersions = async (contractId) => {
    setVersionsForContractId(contractId);
    setContractVersionsLoading(true);
    setError('');
    try {
      const { data } = await api.get(`crm/contracts/${contractId}/versions`);
      setContractVersions(Array.isArray(data?.versions) ? data.versions : []);
    } catch (err) {
      setContractVersions([]);
      setError(err?.networkMessage || err?.response?.data?.msg || '讀取契約版本失敗');
    } finally {
      setContractVersionsLoading(false);
    }
  };

  const openContractPdf = async (contractId) => {
    if (!contractId) return;
    setDownloadingContractPdfId(contractId);
    setError('');
    try {
      const response = await api.get(`crm/contracts/${contractId}/pdf`, { responseType: 'blob', timeout: 60000 });
      const filenameFromHeader = getFilenameFromDisposition(response.headers?.['content-disposition']);
      const blobUrl = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filenameFromHeader || `contract-${contractId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      const blobPayload = err?.response?.data;
      if (typeof Blob !== 'undefined' && blobPayload instanceof Blob) {
        try {
          const parsed = JSON.parse(await blobPayload.text());
          setError([parsed?.msg, parsed?.detail].filter(Boolean).join(' / ') || '下載契約 PDF 失敗');
          return;
        } catch {
          // Fall through to the generic message.
        }
      }
      setError(err?.networkMessage || err?.response?.data?.msg || '下載契約 PDF 失敗');
    } finally {
      setDownloadingContractPdfId(null);
    }
  };

  const openPdf = async (quoteId) => {
    if (!quoteId) return;
    setDownloadingQuotePdfId(quoteId);
    try {
      const response = await api.get(`crm/quotes/${quoteId}/pdf`, { responseType: 'blob', timeout: 60000 });
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
    } finally {
      setDownloadingQuotePdfId(null);
    }
  };

  const openInvoicePdf = async (invoiceId) => {
    if (!invoiceId) return;
    setDownloadingInvoicePdfId(invoiceId);
    try {
      const response = await api.get(`crm/invoices/${invoiceId}/pdf`, { responseType: 'blob', timeout: 60000 });
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
    } finally {
      setDownloadingInvoicePdfId(null);
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
    const existingInvoice = getActiveInvoiceForQuote(quote);
    if (existingInvoice?.id) return;
    setConvertingQuoteId(quoteId);
    setError('');
    try {
      await api.post(`crm/quotes/${quoteId}/convert-to-invoice`);
      await reloadManagedLists();
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '轉成請款單失敗');
    } finally {
      setConvertingQuoteId(null);
    }
  };

  const duplicateQuote = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    setCopyingQuoteId(quoteId);
    setPendingDeleteQuoteId(null);
    setError('');
    try {
      const { data } = await api.post(`crm/quotes/${quoteId}/duplicate`);
      const copiedQuote = data && typeof data === 'object' ? data : null;
      const quoteRows = await loadQuotes();
      await loadInvoices(quoteRows);
      await loadBase();
      if (copiedQuote?.id) {
        setActiveTab('manage');
        startEditQuote(copiedQuote);
      }
    } catch (err) {
      setError(err?.networkMessage || err?.response?.data?.msg || '複製報價單失敗');
    } finally {
      setCopyingQuoteId(null);
    }
  };

  const deleteQuote = async (quote) => {
    const quoteId = Number(quote?.id || 0);
    if (!quoteId) return;
    const quoteLabel = quote?.quote_no || `#${quoteId}`;
    const existingInvoice = getActiveInvoiceForQuote(quote);
    if (existingInvoice?.id) {
      setPendingDeleteQuoteId(null);
      setError(`此報價單已建立請款單 ${existingInvoice.invoice_no || ''}，請先取消請款後再刪除報價單。`);
      return;
    }
    if (pendingDeleteQuoteId !== quoteId) {
      setPendingDeleteQuoteId(quoteId);
      setError(`再按一次「確認刪除」才會刪除報價單 ${quoteLabel}。`);
      return;
    }
    setDeletingQuoteId(quoteId);
    setError('');
    try {
      await api.delete(`crm/quotes/${quoteId}`);
      if (editingQuoteId === quoteId) {
        resetForm();
      }
      setPendingDeleteQuoteId(null);
      await reloadManagedLists();
    } catch (err) {
      const invoiceNo = err?.response?.data?.invoice_no;
      setError(
        invoiceNo
          ? `此報價單已建立請款單 ${invoiceNo}，請先取消請款後再刪除報價單。`
          : err?.networkMessage || err?.response?.data?.msg || '刪除報價單失敗',
      );
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
      await reloadManagedLists();
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
    setInvoiceSignatureName(
      invoice?.customer_signature_name || invoice?.recipient_name || invoice?.contact_name || invoice?.customer_name || '',
    );
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
      await reloadManagedLists();
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
      await reloadManagedLists();
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
      await reloadManagedLists();
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

      <nav className="tab-bar" aria-label="報價功能分頁" style={{ marginBottom: 16 }}>
        <button type="button" className={activeTab === 'manage' ? 'tab active' : 'tab'} onClick={() => setActiveTab('manage')}>
          報價管理
        </button>
        <button type="button" className={activeTab === 'usage' ? 'tab active' : 'tab'} onClick={() => setActiveTab('usage')}>
          品項使用紀錄
        </button>
      </nav>

      {activeTab === 'manage' ? (
        <>

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
                  <option value="tax">稅金（5%預填，可修改）</option>
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
                  step={isManualTaxItem(item) ? '1' : '0.1'}
                />
                <input
                  type="number"
                  value={item.unit_price}
                  onChange={(event) => handleItemChange(idx, 'unit_price', event.target.value)}
                  placeholder="單價"
                  step={isManualTaxItem(item) ? '1' : '0.1'}
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

      {contractForm ? (
        <section ref={contractFormSectionRef} className="panel crm-contract-editor" tabIndex="-1">
          <div className="panel-header">
            <div>
              <h2>{editingContractId ? '編輯工程承攬契約' : '建立工程承攬契約'}</h2>
              <p className="hint-text">
                來源估價單 {contractForm.quote_no}；建立時會鎖定當下估價單版本與品項快照。
              </p>
            </div>
            <span className="panel-tag">範本請交由台灣律師／法務確認</span>
          </div>
          <form className="stack" onSubmit={saveContract}>
            <div className="crm-form-grid">
              <label>
                契約日期
                <input
                  type="date"
                  value={contractForm.contract_date}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, contract_date: event.target.value }))}
                  required
                />
              </label>
              <label>
                契約狀態
                <select
                  value={contractForm.status}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <option value="draft">草稿</option>
                  <option value="ready">待簽署</option>
                  <option value="signed">已簽署</option>
                  <option value="cancelled">已取消</option>
                </select>
              </label>
              <label>
                工程名稱
                <input
                  value={contractForm.project_name}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, project_name: event.target.value }))}
                  required
                />
              </label>
              <label>
                施工地點
                <input
                  value={contractForm.site_address}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, site_address: event.target.value }))}
                />
              </label>
              <label>
                預定開工日
                <input
                  type="date"
                  value={contractForm.start_date}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, start_date: event.target.value }))}
                />
              </label>
              <label>
                預定完工日
                <input
                  type="date"
                  value={contractForm.end_date}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, end_date: event.target.value }))}
                />
              </label>
              <label>
                甲方名稱
                <input
                  value={contractForm.party_a_name}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_a_name: event.target.value }))}
                  required
                />
              </label>
              <label>
                甲方統編／識別資料
                <input
                  value={contractForm.party_a_tax_id}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_a_tax_id: event.target.value }))}
                />
              </label>
              <label>
                甲方電話
                <input
                  value={contractForm.party_a_phone}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_a_phone: event.target.value }))}
                />
              </label>
              <label>
                甲方地址
                <input
                  value={contractForm.party_a_address}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_a_address: event.target.value }))}
                />
              </label>
              <label>
                乙方名稱
                <input
                  value={contractForm.party_b_name}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_b_name: event.target.value }))}
                  required
                />
              </label>
              <label>
                乙方統一編號
                <input
                  value={contractForm.party_b_tax_id}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_b_tax_id: event.target.value }))}
                />
              </label>
              <label>
                乙方電話
                <input
                  value={contractForm.party_b_phone}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_b_phone: event.target.value }))}
                />
              </label>
              <label>
                乙方地址
                <input
                  value={contractForm.party_b_address}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, party_b_address: event.target.value }))}
                />
              </label>
              <label>
                保固（月）
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={contractForm.warranty_months}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, warranty_months: event.target.value }))}
                />
              </label>
            </div>
            <label>
              付款方式
              <textarea
                value={contractForm.payment_terms}
                onChange={(event) => setContractForm((prev) => ({ ...prev, payment_terms: event.target.value }))}
                rows="3"
                required
              />
            </label>
            <label>
              特別約定
              <textarea
                value={contractForm.special_terms}
                onChange={(event) => setContractForm((prev) => ({ ...prev, special_terms: event.target.value }))}
                rows="4"
                placeholder="例如進場時間、材料指定、停水停電配合方式；沒有可留白。"
              />
            </label>
            {editingContractId ? (
              <label>
                本次修改摘要
                <input
                  value={contractForm.version_summary}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, version_summary: event.target.value }))}
                  placeholder="例如：調整付款比例與完工日期"
                />
              </label>
            ) : null}
            <div className="crm-form-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setContractForm(null);
                  setEditingContractId(null);
                }}
                disabled={savingContract}
              >
                取消
              </button>
              <button type="submit" disabled={savingContract}>
                {savingContract ? '儲存中...' : editingContractId ? '儲存並建立新版本' : '建立契約'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {versionsForContractId ? (
        <section className="panel panel--table">
          <div className="panel-header">
            <h2>契約版本紀錄</h2>
            <span className="panel-tag">契約 #{versionsForContractId}</span>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>版本</th><th>動作</th><th>時間</th><th>人員</th><th>摘要</th></tr>
              </thead>
              <tbody>
                {contractVersions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version_no}</td>
                    <td>{version.action || '-'}</td>
                    <td>{version.created_at || '-'}</td>
                    <td>{version.changed_by_username || '-'}</td>
                    <td>{version.summary || '-'}</td>
                  </tr>
                ))}
                {!contractVersionsLoading && contractVersions.length === 0 ? (
                  <tr><td colSpan="5">尚無契約版本紀錄</td></tr>
                ) : null}
                {contractVersionsLoading ? <tr><td colSpan="5">載入中...</td></tr> : null}
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

      <section ref={invoiceListSectionRef} className="panel panel--table">
        <div className="panel-header">
          <h2>報價單列表</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setReloadKey((value) => value + 1)}
              disabled={loading}
            >
              {loading ? '載入中...' : '重新整理'}
            </button>
          </div>
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
                  {(() => {
                    const activeInvoice = getActiveInvoiceForQuote(quote);
                    const hasActiveInvoice = Boolean(activeInvoice?.id);
                    const quoteContracts = contractsByQuoteId.get(Number(quote.id)) || [];
                    const latestContract = quoteContracts[0] || null;
                    return (
                      <>
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
                      disabled={convertingQuoteId === quote.id || hasActiveInvoice}
                    >
                      {convertingQuoteId === quote.id
                        ? '轉換中...'
                        : hasActiveInvoice
                          ? '已轉請款單'
                          : '轉成請款單'}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => openPdf(quote.id)}
                      disabled={downloadingQuotePdfId === quote.id}
                    >
                      {downloadingQuotePdfId === quote.id ? 'PDF產生中...' : 'PDF下載'}
                    </button>
                    {latestContract ? (
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => openContractPdf(latestContract.id)}
                        disabled={downloadingContractPdfId === latestContract.id}
                      >
                        {downloadingContractPdfId === latestContract.id ? '契約產生中...' : '契約 PDF'}
                      </button>
                    ) : (
                      <button type="button" className="secondary-btn" onClick={() => openContractEditor(quote)}>
                        建立契約
                      </button>
                    )}
                    <button type="button" className="secondary-btn" onClick={() => downloadXlsx(quote)}>
                      XLSX
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => startEditQuote(quote)}
                      disabled={hasActiveInvoice}
                      title={hasActiveInvoice ? '已轉成請款單，請先取消請款單再編輯' : undefined}
                    >
                      {hasActiveInvoice ? '請先取消請款' : '編輯'}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => duplicateQuote(quote)}
                      disabled={copyingQuoteId === quote.id}
                    >
                      {copyingQuoteId === quote.id ? '複製中...' : '複製'}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => deleteQuote(quote)}
                      disabled={deletingQuoteId === quote.id}
                    >
                      {deletingQuoteId === quote.id
                        ? '刪除中...'
                        : pendingDeleteQuoteId === Number(quote.id)
                          ? '確認刪除'
                          : '刪除'}
                    </button>
                    <button type="button" className="secondary-btn" onClick={() => loadQuoteVersions(quote.id)}>
                      版本
                    </button>
                  </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
              {!loading && quotes.length === 0 ? (
                <tr>
                  <td colSpan="4">{error ? '目前無法載入報價資料，請按重新整理再試。' : '目前沒有報價單。'}</td>
                </tr>
              ) : null}
              {loading && quotes.length === 0 ? (
                <tr>
                  <td colSpan="4">報價資料載入中...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <div>
            <h2>工程承攬契約</h2>
            <p className="muted-text">契約由個案手動建立，並固定綁定建立當下的估價單版本。</p>
          </div>
          <span className="panel-tag">{contracts.length} 份</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>契約編號</th>
                <th>來源估價單</th>
                <th>甲方／工程</th>
                <th>狀態</th>
                <th>金額</th>
                <th>版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => {
                const sourceQuote = quotes.find((quote) => Number(quote.id) === Number(contract.quote_id));
                const isSigned = String(contract.status || '').toLowerCase() === 'signed';
                return (
                  <tr key={contract.id}>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <strong>{contract.contract_no || '-'}</strong>
                        <span style={{ fontSize: '0.86rem', color: '#7a8797' }}>
                          {formatListDate(contract.contract_date || contract.created_at)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <span>{contract.quote_no || '-'}</span>
                        <span style={{ fontSize: '0.86rem', color: '#7a8797' }}>
                          綁定 v{contract.quote_version_no || 1}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <strong>{contract.party_a_name || '-'}</strong>
                        <span style={{ fontSize: '0.86rem', color: '#7a8797' }}>
                          {contract.project_name || '-'}
                        </span>
                      </div>
                    </td>
                    <td>{crmStatusLabel('contract', contract.status)}</td>
                    <td>{quoteDisplayAmount(contract)}</td>
                    <td>v{contract.version_count || 1}</td>
                    <td className="crm-actions-cell">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => openContractPdf(contract.id)}
                        disabled={downloadingContractPdfId === contract.id}
                      >
                        {downloadingContractPdfId === contract.id ? 'PDF產生中...' : 'PDF下載'}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => openContractEditor(sourceQuote || contract, contract)}
                        disabled={isSigned}
                        title={isSigned ? '已簽署契約不可直接覆寫，請建立補充協議或新契約' : undefined}
                      >
                        {isSigned ? '已鎖定' : '編輯'}
                      </button>
                      <button type="button" className="secondary-btn" onClick={() => loadContractVersions(contract.id)}>
                        版本
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && contracts.length === 0 ? (
                <tr><td colSpan="7">尚無工程契約；請從報價單選擇個案建立。</td></tr>
              ) : null}
              {loading ? <tr><td colSpan="7">載入中...</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--table">
        <div className="panel-header">
          <h2>請款單列表</h2>
          <span className="panel-tag">同步目前報價列表</span>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>請款單號</th>
                <th>來源報價單</th>
                <th>台照顯示名稱</th>
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
                  <td>{invoice.recipient_name || invoice.customer_name || invoice.contact_name || '-'}</td>
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
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => openInvoicePdf(invoice.id)}
                      disabled={downloadingInvoicePdfId === invoice.id}
                    >
                      {downloadingInvoicePdfId === invoice.id ? 'PDF產生中...' : 'PDF下載'}
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
        </>
      ) : null}

      {activeTab === 'usage' ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>品項使用紀錄</h2>
              <span className="panel-tag">可選品項或輸入關鍵字</span>
            </div>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                searchItemUsage();
              }}
            >
              <div className="crm-form-grid">
                <label>
                  選擇品項
                  <select value={itemUsageCatalogId} onChange={(event) => setItemUsageCatalogId(event.target.value || '')}>
                    <option value="">請選擇價目品項</option>
                    {catalogItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  關鍵字搜尋
                  <input
                    value={itemUsageKeyword}
                    onChange={(event) => setItemUsageKeyword(event.target.value)}
                    placeholder="例如：配線、燈具、漏水"
                  />
                </label>
              </div>

              <div className="crm-form-actions">
                <button type="submit" disabled={itemUsageLoading}>
                  {itemUsageLoading ? '查詢中...' : '搜尋'}
                </button>
                <button type="button" className="secondary-btn" onClick={resetItemUsageSearch} disabled={itemUsageLoading}>
                  清除條件
                </button>
              </div>

              <div className="crm-actions-cell">
                {selectedUsageCatalogItem ? (
                  <span className="panel-tag">品項：{selectedUsageCatalogItem.name}</span>
                ) : null}
                {itemUsageKeyword.trim() ? <span className="panel-tag">關鍵字：{itemUsageKeyword.trim()}</span> : null}
                {itemUsageSearched ? (
                  <>
                    <span className="panel-tag">估價單 {itemUsageMeta.total_quotes} 張</span>
                    <span className="panel-tag">符合品項 {itemUsageMeta.total_matches} 筆</span>
                  </>
                ) : null}
              </div>
            </form>
          </section>

          <section className="panel panel--table">
            <div className="panel-header">
              <h2>搜尋結果</h2>
              <span className="panel-tag">最多顯示 100 筆符合資料</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>報價單號</th>
                    <th>客戶</th>
                    <th>日期</th>
                    <th>符合品項</th>
                    <th>報價金額</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {itemUsageResults.map((row) => (
                    <tr key={row.quote?.id}>
                      <td>{row.quote?.quote_no || '-'}</td>
                      <td>{row.quote?.customer_name || row.quote?.recipient_name || row.quote?.contact_name || '-'}</td>
                      <td>{formatListDate(row.quote?.issue_date || row.quote?.updated_at)}</td>
                      <td>
                        <div style={{ display: 'grid', gap: 6, minWidth: 260 }}>
                          {(Array.isArray(row.matched_items) ? row.matched_items : []).map((item) => (
                            <div key={item.id} className="panel-tag" style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                              <strong>{item.description || '-'}</strong>
                              {` / ${Number(item.quantity || 0).toFixed(2)} ${item.unit || ''} / NT$ ${Number(item.amount || 0).toFixed(2)}`}
                              {item.note ? ` / 備註：${item.note}` : ''}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>{quoteDisplayAmount(row.quote || {})}</td>
                      <td>{crmStatusLabel('quote', row.quote?.status)}</td>
                      <td className="crm-actions-cell">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => openPdf(row.quote?.id)}
                          disabled={downloadingQuotePdfId === row.quote?.id}
                        >
                          {downloadingQuotePdfId === row.quote?.id ? 'PDF產生中...' : 'PDF下載'}
                        </button>
                        {quotes.some((quote) => Number(quote.id) === Number(row.quote?.id)) ? (
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              const matchedQuote = quotes.find((quote) => Number(quote.id) === Number(row.quote?.id));
                              if (matchedQuote) {
                                setActiveTab('manage');
                                startEditQuote(matchedQuote);
                              }
                            }}
                            disabled={Boolean(getActiveInvoiceForQuote(quotes.find((quote) => Number(quote.id) === Number(row.quote?.id))))}
                          >
                            {getActiveInvoiceForQuote(quotes.find((quote) => Number(quote.id) === Number(row.quote?.id))) ? '請先取消請款' : '編輯'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!itemUsageLoading && !itemUsageSearched ? (
                    <tr>
                      <td colSpan="7">先選品項或輸入關鍵字，再按搜尋</td>
                    </tr>
                  ) : null}
                  {!itemUsageLoading && itemUsageSearched && itemUsageResults.length === 0 ? (
                    <tr>
                      <td colSpan="7">查無符合的估價單</td>
                    </tr>
                  ) : null}
                  {itemUsageLoading ? (
                    <tr>
                      <td colSpan="7">查詢中...</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default CrmQuotesPage;
