import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  supabase,
  AdminProfile,
  Announcement,
  CustomerProfile,
  GalleryImage,
  GameSettings,
  MenuItem,
  Order,
  OrderItem,
  PaymentMethodSetting,
  PROMO_CARD_IMAGE_BUCKET,
  promoCardImagePublicUrl,
} from '../lib/supabase';
import { extractCustomerInstructionFromNotes } from '../lib/orderNotes';
import { useAuth } from '../contexts/AuthContext';
import {
  Pizza,
  ImageIcon,
  Megaphone,
  Gamepad2,
  QrCode,
  Archive,
  Users,
  ChevronDown,
  Ban,
  UserCheck,
  Trash2,
  ClipboardList,
  Loader2,
  Menu as MenuIcon,
  Search,
  SlidersHorizontal,
  X,
  LogOut,
} from 'lucide-react';

type OrderWithItems = Order & {
  order_items: OrderItem[];
};

type TabId = 'orders' | 'archived' | 'menu' | 'announcements' | 'gallery' | 'gcash' | 'game' | 'users' | 'admins';

const STATUS_LABELS: { id: Order['status']; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'on_the_way', label: 'On the Way' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const ADMIN_TAB_STORAGE_KEY = 'kaedys_admin_active_tab';
const WALLET_METHODS: PaymentMethodSetting['method'][] = ['GCash', 'Maya', 'PayPal'];
function toTitleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function isTabId(value: string): value is TabId {
  return (
    value === 'orders' ||
    value === 'archived' ||
    value === 'menu' ||
    value === 'announcements' ||
    value === 'gallery' ||
    value === 'gcash' ||
    value === 'game' ||
    value === 'users' ||
    value === 'admins'
  );
}

function AdminCategoryDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeLabel = value === 'All' ? 'All Categories' : value;

  useEffect(() => {
    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 pl-9 pr-10 py-2.5 rounded-xl border border-yellow-500/25 bg-black/40 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <span className="truncate">{activeLabel}</span>
        <span className="ml-auto text-gray-400">▾</span>
      </button>

      {value !== 'All' && (
        <button
          type="button"
          onClick={() => onChange('All')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10"
          aria-label="Clear category"
          title="Clear"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {open && (
        <div
          className="absolute z-50 mt-2 w-full rounded-xl border border-yellow-500/30 bg-neutral-950/95 shadow-2xl overflow-hidden"
          role="listbox"
        >
          <button
            type="button"
            onClick={() => {
              onChange('All');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              value === 'All'
                ? 'bg-yellow-400/15 text-yellow-200'
                : 'text-gray-200 hover:bg-white/5'
            }`}
          >
            All Categories
          </button>
          <div className="h-px bg-yellow-500/15" />
          <div className="max-h-56 overflow-auto">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  value === opt
                    ? 'bg-yellow-400/15 text-yellow-200'
                    : 'text-gray-200 hover:bg-white/5'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function sendStatusEmail(order: Order, newStatus: Order['status']) {
  const webhookUrl = import.meta.env.VITE_STATUS_EMAIL_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: order.id,
        status: newStatus,
        paymentMethod: order.payment_method,
        finalAmount: order.final_amount,
      }),
    });
  } catch (error) {
    console.error('Error calling status email webhook', error);
  }
}

type ImageCompressOptions = {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  quality?: number;
};

async function compressImageBeforeUpload(file: File, opts: ImageCompressOptions): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= opts.maxBytes) return file;

  const qualityStart = opts.quality ?? 0.82;
  const qualities = [qualityStart, 0.72, 0.62, 0.52, 0.42];
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });

    const ratio = Math.min(opts.maxWidth / img.width, opts.maxHeight / img.height, 1);
    const targetW = Math.max(1, Math.round(img.width * ratio));
    const targetH = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let bestBlob: Blob | null = null;
    for (const q of qualities) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/webp', q);
      });
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= opts.maxBytes) {
        bestBlob = blob;
        break;
      }
    }

    if (!bestBlob || bestBlob.size >= file.size) return file;

    const safeBaseName = file.name.replace(/\.[^.]+$/, '');
    return new File([bestBlob], `${safeBaseName}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function AdminPage() {
  const { signOut, adminProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const fromHash = window.location.hash.replace('#', '');
    if (isTabId(fromHash)) return fromHash;
    const fromStorage = localStorage.getItem(ADMIN_TAB_STORAGE_KEY) || '';
    if (isTabId(fromStorage)) return fromStorage;
    return 'orders';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMasterAdmin = !!adminProfile?.is_master_admin;

  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [markingAllCompleted, setMarkingAllCompleted] = useState(false);
  const [archivedOrders, setArchivedOrders] = useState<OrderWithItems[]>([]);
  const [archivedOrdersLoading, setArchivedOrdersLoading] = useState(false);
  const [selectedArchivedOrderIds, setSelectedArchivedOrderIds] = useState<Set<string>>(new Set());
  const [deletingSelectedArchivedOrders, setDeletingSelectedArchivedOrders] = useState(false);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [deleteMenuItem, setDeleteMenuItem] = useState<MenuItem | null>(null);
  const [deletingMenuItem, setDeletingMenuItem] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuCategory, setMenuCategory] = useState<string>('All');
  const [menuForm, setMenuForm] = useState({
    category: '',
    custom_category: '',
    subcategory: '',
    name: '',
    description: '',
    price: '',
    imageFile: null as File | null,
    image_url: '',
  });

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    content: '',
    promo_type: 'card' as 'card' | 'marquee',
    cardImageFile: null as File | null,
  });
  const [removingCardImageId, setRemovingCardImageId] = useState<string | null>(null);

  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [gameSettings, setGameSettings] = useState<GameSettings | null>(null);
  const [gameLoading, setGameLoading] = useState(false);

  const [paymentSettings, setPaymentSettings] = useState<Record<PaymentMethodSetting['method'], PaymentMethodSetting>>({
    GCash: { method: 'GCash', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
    Maya: { method: 'Maya', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
    PayPal: { method: 'PayPal', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
  });
  const [paymentDrafts, setPaymentDrafts] = useState<
    Record<PaymentMethodSetting['method'], { file: File | null; accountNumber: string; accountName: string }>
  >({
    GCash: { file: null, accountNumber: '', accountName: '' },
    Maya: { file: null, accountNumber: '', accountName: '' },
    PayPal: { file: null, accountNumber: '', accountName: '' },
  });
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [savingPaymentMethod, setSavingPaymentMethod] = useState<PaymentMethodSetting['method'] | null>(null);

  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [customersById, setCustomersById] = useState<Record<string, CustomerProfile>>({});
  const [managedUsers, setManagedUsers] = useState<CustomerProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [noticeModal, setNoticeModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    variant: 'success' | 'error' | 'info';
  }>({
    open: false,
    title: '',
    message: '',
    variant: 'info',
  });
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    resolver: ((value: boolean) => void) | null;
  }>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    resolver: null,
  });

  useEffect(() => {
    localStorage.setItem(ADMIN_TAB_STORAGE_KEY, activeTab);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#${activeTab}`
    );
  }, [activeTab]);

  useEffect(() => {
    const onHashChange = () => {
      const tab = window.location.hash.replace('#', '');
      if (isTabId(tab)) setActiveTab(tab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!isMasterAdmin && (activeTab === 'admins' || activeTab === 'users' || activeTab === 'gcash')) {
      setActiveTab('orders');
    }
  }, [activeTab, isMasterAdmin]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of menuItems) {
      const label =
        item.category === 'Others' ? item.custom_category?.trim() || 'Others' : item.category?.trim();
      if (label) set.add(label);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [menuItems]);

  const filterCategoryOptions = categoryOptions;

  const filteredMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems.filter((item) => {
      const categoryLabel =
        item.category === 'Others' ? item.custom_category || 'Others' : item.category;

      const matchesCategory = menuCategory === 'All' ? true : categoryLabel === menuCategory;
      const matchesQuery = !q
        ? true
        : [
            item.name,
            item.description,
            item.category,
            item.custom_category || '',
            categoryLabel,
            String(item.price ?? ''),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q);

      return matchesCategory && matchesQuery;
    });
  }, [menuCategory, menuItems, menuSearch]);

  const paymentPreviewUrls = useMemo(() => {
    const result: Record<PaymentMethodSetting['method'], string | null> = {
      GCash: null,
      Maya: null,
      PayPal: null,
    };
    for (const method of WALLET_METHODS) {
      const row = paymentSettings[method];
      if (!row?.qr_storage_path) continue;
      const { data } = supabase.storage.from('payment-qr').getPublicUrl(row.qr_storage_path);
      result[method] = `${data.publicUrl}?v=${encodeURIComponent(row.updated_at)}`;
    }
    return result;
  }, [paymentSettings]);

  useEffect(() => {
    if (menuCategory !== 'All' && !filterCategoryOptions.includes(menuCategory)) {
      setMenuCategory('All');
    }
  }, [filterCategoryOptions, menuCategory]);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      let { data, error } = await supabase
        .from('orders')
        .select('*, order_items (*)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error && (error as { code?: string }).code === '42703') {
        // Backward compatibility while archive migration is not yet applied.
        const fallback = await supabase
          .from('orders')
          .select('*, order_items (*)')
          .order('created_at', { ascending: false })
          .limit(50);
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;
      const ordersData = (data || []) as OrderWithItems[];
      setOrders(ordersData);

      const userIds = Array.from(new Set(ordersData.map((o) => o.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: customers, error: custError } = await supabase
          .from('customer_profiles')
          .select('*')
          .in('id', userIds);
        if (custError) throw custError;
        const map: Record<string, CustomerProfile> = {};
        for (const c of customers || []) {
          map[c.id] = c as CustomerProfile;
        }
        setCustomersById(map);
      } else {
        setCustomersById({});
      }
    } catch (error) {
      console.error('Error loading orders', error);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const fetchArchivedOrders = useCallback(async () => {
    setArchivedOrdersLoading(true);
    try {
      let { data, error } = await supabase
        .from('orders')
        .select('*, order_items (*)')
        .eq('is_archived', true)
        .order('archived_at', { ascending: false })
        .limit(100);

      if (error && (error as { code?: string }).code === '42703') {
        // If archive columns are missing, keep archived list empty instead of breaking admin page.
        setArchivedOrders([]);
        return;
      }

      if (error) throw error;
      const archived = (data || []) as OrderWithItems[];
      setArchivedOrders(archived);
      setSelectedArchivedOrderIds((prev) => {
        const ids = new Set(archived.map((o) => o.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        return next;
      });

      const userIds = Array.from(new Set(archived.map((o) => o.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: customers, error: custError } = await supabase
          .from('customer_profiles')
          .select('*')
          .in('id', userIds);
        if (custError) throw custError;
        const map: Record<string, CustomerProfile> = {};
        for (const c of customers || []) {
          map[c.id] = c as CustomerProfile;
        }
        setCustomersById((prev) => ({ ...prev, ...map }));
      }
    } catch (error) {
      console.error('Error loading archived orders', error);
    } finally {
      setArchivedOrdersLoading(false);
    }
  }, []);

  const fetchMenuItems = async () => {
    setMenuLoading(true);
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMenuItems((data || []) as MenuItem[]);
    } catch (error) {
      console.error('Error loading menu items', error);
    } finally {
      setMenuLoading(false);
    }
  };

  const updateOrderStatus = async (order: OrderWithItems, status: Order['status']) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', order.id);

      if (error) throw error;
      await sendStatusEmail(order, status);
      await fetchOrders();
      // DB trigger archives completed orders / updates archive flags — keep both lists in sync.
      await fetchArchivedOrders();
    } catch (error) {
      console.error('Error updating order status', error);
    }
  };

  const markAllOrdersCompleted = async () => {
    const targetIds = orders
      .filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
      .map((o) => o.id);

    if (targetIds.length === 0) {
      openNoticeModal('No active orders', 'There are no active orders to mark as completed.', 'info');
      return;
    }

    const ok = await askConfirm(
      'Mark all as completed',
      `Mark ${targetIds.length} order(s) as completed and move them to archive?`,
      'Yes, complete all',
      'Cancel'
    );
    if (!ok) return;

    setMarkingAllCompleted(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'completed' })
        .in('id', targetIds);
      if (error) throw error;

      await fetchOrders();
      await fetchArchivedOrders();
      openNoticeModal('Orders completed', `${targetIds.length} order(s) moved to archive.`, 'success');
    } catch (error) {
      console.error('Error marking all orders completed', error);
      openNoticeModal('Update failed', 'Could not mark all orders as completed.', 'error');
    } finally {
      setMarkingAllCompleted(false);
    }
  };

  const deleteArchivedOrder = async (order: OrderWithItems) => {
    const ok = await askConfirm(
      'Delete archived order',
      `Delete archived order #${order.id.slice(0, 8)} permanently?`,
      'Delete',
      'Cancel'
    );
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('id', order.id)
        .eq('is_archived', true);
      if (error) throw error;
      await fetchArchivedOrders();
      openNoticeModal('Archived order deleted', `Order #${order.id.slice(0, 8)} was deleted.`, 'success');
    } catch (error) {
      console.error('Error deleting archived order', error);
      openNoticeModal('Delete failed', 'Could not delete archived order. Please try again.', 'error');
    }
  };

  const toggleSelectArchivedOrder = (orderId: string) => {
    setSelectedArchivedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectAllArchivedOrders = () => {
    setSelectedArchivedOrderIds(new Set(archivedOrders.map((o) => o.id)));
  };

  const clearArchivedSelection = () => {
    setSelectedArchivedOrderIds(new Set());
  };

  const deleteSelectedArchivedOrders = async () => {
    const ids = Array.from(selectedArchivedOrderIds);
    if (ids.length === 0) return;
    const ok = await askConfirm(
      'Delete selected archived orders',
      `Delete ${ids.length} archived order(s) permanently?`,
      'Delete selected',
      'Cancel'
    );
    if (!ok) return;
    setDeletingSelectedArchivedOrders(true);
    try {
      const { error } = await supabase
        .from('orders')
        .delete()
        .eq('is_archived', true)
        .in('id', ids);
      if (error) throw error;
      await fetchArchivedOrders();
      setSelectedArchivedOrderIds(new Set());
      openNoticeModal('Archived orders deleted', `${ids.length} archived order(s) were deleted.`, 'success');
    } catch (error) {
      console.error('Error deleting selected archived orders', error);
      openNoticeModal('Delete failed', 'Could not delete selected archived orders.', 'error');
    } finally {
      setDeletingSelectedArchivedOrders(false);
    }
  };

  const toggleMenuAvailability = async (item: MenuItem) => {
    try {
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: !item.is_available })
        .eq('id', item.id);
      if (error) throw error;
      await fetchMenuItems();
    } catch (error) {
      console.error('Error updating menu availability', error);
    }
  };

  const fetchAnnouncements = async () => {
    setAnnLoading(true);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAnnouncements((data || []) as Announcement[]);
    } catch (error) {
      console.error('Error loading announcements', error);
    } finally {
      setAnnLoading(false);
    }
  };

  // When notification system detects a new order (via polling),
  // refresh the orders list if the Orders tab is currently active.
  useEffect(() => {
    const handler = () => {
      if (activeTab === 'orders') {
        fetchOrders();
      }
    };
    window.addEventListener('kaedys:new-order', handler as EventListener);
    return () => window.removeEventListener('kaedys:new-order', handler as EventListener);
  }, [activeTab, fetchOrders]);

  useEffect(() => {
    // Always load admin data for any logged-in user on the admin site
    fetchOrders();
    fetchArchivedOrders();
    fetchMenuItems();
    fetchAnnouncements();
    fetchGallery();
    fetchGameSettings();
    if (isMasterAdmin) {
      fetchAdmins();
      fetchManagedUsers();
    }
  }, [isMasterAdmin, fetchOrders, fetchArchivedOrders]);

  // Realtime updates for orders list:
  // re-fetch only when there are INSERT/UPDATE/DELETE events on orders
  // (no constant polling while the admin is reading).
  useEffect(() => {
    const channel = supabase
      .channel('admin-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          if (activeTab === 'orders' || activeTab === 'archived') {
            fetchOrders();
            fetchArchivedOrders();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab, fetchOrders, fetchArchivedOrders]);

  // Fresh archive list when opening the Archive tab (e.g. after completing orders on Orders).
  useEffect(() => {
    if (activeTab !== 'archived') return;
    fetchArchivedOrders();
  }, [activeTab, fetchArchivedOrders]);

  const createAnnouncement = async () => {
    const title = newAnnouncement.title.trim();
    const content = newAnnouncement.content.trim();
    if (newAnnouncement.promo_type === 'card') {
      if (!title || !content) return;
    } else if (!content) {
      return;
    }
    const titleForDb = newAnnouncement.promo_type === 'marquee' ? title || 'Promo' : title;
    let uploadedPath: string | null = null;
    try {
      if (newAnnouncement.promo_type === 'card' && newAnnouncement.cardImageFile) {
        const file = newAnnouncement.cardImageFile;
        if (!file.type.startsWith('image/')) {
          openNoticeModal('Invalid file', 'Please choose an image file (PNG, JPG, WebP, or GIF).', 'error');
          return;
        }
        const ext = file.name.split('.').pop() || 'jpg';
        const objectPath = `cards/${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage
          .from(PROMO_CARD_IMAGE_BUCKET)
          .upload(objectPath, file, { cacheControl: '3600', upsert: false });
        if (upErr) throw upErr;
        uploadedPath = up.path;
      }

      const { error } = await supabase.from('announcements').insert([
        {
          title: titleForDb,
          content,
          active: true,
          promo_type: newAnnouncement.promo_type,
          card_image_path: newAnnouncement.promo_type === 'card' ? uploadedPath : null,
        },
      ]);

      if (error) {
        if (uploadedPath) {
          await supabase.storage.from(PROMO_CARD_IMAGE_BUCKET).remove([uploadedPath]);
        }
        throw error;
      }
      setNewAnnouncement({ title: '', content: '', promo_type: 'card', cardImageFile: null });
      await fetchAnnouncements();
    } catch (error) {
      console.error('Error creating announcement', error);
      openNoticeModal('Could not post promo', 'Check your connection and try again.', 'error');
    }
  };

  const removeAnnouncementCardImage = async (announcement: Announcement) => {
    if (!announcement.card_image_path) return;
    const ok = await askConfirm(
      'Remove promo image',
      'Delete this image from storage? Title and text stay on the promo.',
      'Remove image',
      'Cancel'
    );
    if (!ok) return;
    setRemovingCardImageId(announcement.id);
    try {
      const { error: rmErr } = await supabase.storage
        .from(PROMO_CARD_IMAGE_BUCKET)
        .remove([announcement.card_image_path]);
      if (rmErr) console.warn('Storage remove', rmErr);
      const { error } = await supabase
        .from('announcements')
        .update({ card_image_path: null })
        .eq('id', announcement.id);
      if (error) throw error;
      await fetchAnnouncements();
      openNoticeModal('Image removed', 'Promo card image was deleted.', 'success');
    } catch (error) {
      console.error('Error removing promo image', error);
      openNoticeModal('Remove failed', 'Could not remove the image.', 'error');
    } finally {
      setRemovingCardImageId(null);
    }
  };

  const toggleAnnouncementActive = async (announcement: Announcement) => {
    try {
      const { error } = await supabase
        .from('announcements')
        .update({ active: !announcement.active })
        .eq('id', announcement.id);

      if (error) throw error;
      await fetchAnnouncements();
    } catch (error) {
      console.error('Error updating announcement', error);
      openNoticeModal('Update failed', 'Failed to update promo visibility.', 'error');
    }
  };

  const deleteAnnouncement = async (announcement: Announcement) => {
    const ok = await askConfirm(
      'Delete promo',
      `Delete "${announcement.title}"? This action cannot be undone.`,
      'Delete',
      'Cancel'
    );
    if (!ok) return;

    try {
      if (announcement.card_image_path) {
        const { error: rmErr } = await supabase.storage
          .from(PROMO_CARD_IMAGE_BUCKET)
          .remove([announcement.card_image_path]);
        if (rmErr) console.warn('Could not delete promo image from storage', rmErr);
      }
      const { error } = await supabase.from('announcements').delete().eq('id', announcement.id);
      if (error) throw error;
      await fetchAnnouncements();
      openNoticeModal('Promo deleted', `"${announcement.title}" was removed.`, 'success');
    } catch (error) {
      console.error('Error deleting announcement', error);
      openNoticeModal('Delete failed', 'Failed to delete promo.', 'error');
    }
  };

  const fetchGallery = async () => {
    setGalleryLoading(true);
    try {
      const { data, error } = await supabase
        .from('gallery_images')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setGalleryImages((data || []) as GalleryImage[]);
    } catch (error) {
      console.error('Error loading gallery', error);
    } finally {
      setGalleryLoading(false);
    }
  };

  const handleGalleryUpload = async (file: File | null) => {
    if (!file) return;
    if (galleryImages.length >= 10) {
      openNoticeModal('Limit reached', 'Maximum of 10 gallery images reached.', 'info');
      return;
    }

    setUploadingImage(true);
    try {
      const uploadFile = await compressImageBeforeUpload(file, {
        maxWidth: 1400,
        maxHeight: 1400,
        maxBytes: 700 * 1024,
        quality: 0.82,
      });
      const fileExt = uploadFile.name.split('.').pop();
      const fileName = `gallery-${Date.now()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('gallery')
        .upload(fileName, uploadFile);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('gallery').getPublicUrl(uploadData.path);

      const { error: insertError } = await supabase
        .from('gallery_images')
        .insert([
          {
            image_url: urlData.publicUrl,
            display_order: galleryImages.length + 1,
          },
        ]);

      if (insertError) throw insertError;
      await fetchGallery();
    } catch (error) {
      console.error('Error uploading gallery image', error);
    } finally {
      setUploadingImage(false);
    }
  };

  const fetchPaymentSettings = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('payment_method_settings')
        .select('method, qr_storage_path, account_number, account_name, updated_at')
        .in('method', WALLET_METHODS);
      if (error) throw error;

      const nextSettings: Record<PaymentMethodSetting['method'], PaymentMethodSetting> = {
        GCash: { method: 'GCash', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
        Maya: { method: 'Maya', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
        PayPal: { method: 'PayPal', qr_storage_path: null, account_number: '', account_name: '', updated_at: new Date().toISOString() },
      };
      const nextDrafts: Record<PaymentMethodSetting['method'], { file: File | null; accountNumber: string; accountName: string }> = {
        GCash: { file: null, accountNumber: '', accountName: '' },
        Maya: { file: null, accountNumber: '', accountName: '' },
        PayPal: { file: null, accountNumber: '', accountName: '' },
      };

      for (const row of (data || []) as PaymentMethodSetting[]) {
        nextSettings[row.method] = {
          method: row.method,
          qr_storage_path: row.qr_storage_path ?? null,
          account_number: row.account_number ?? '',
          account_name: row.account_name ?? '',
          updated_at: row.updated_at || new Date().toISOString(),
        };
        nextDrafts[row.method] = {
          file: null,
          accountNumber: row.account_number ?? '',
          accountName: row.account_name ?? '',
        };
      }
      setPaymentSettings(nextSettings);
      setPaymentDrafts(nextDrafts);
    } catch (error) {
      console.error('Error loading payment settings', error);
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  const savePaymentMethod = async (method: PaymentMethodSetting['method']) => {
    const draft = paymentDrafts[method];
    setSavingPaymentMethod(method);
    const previous = paymentSettings[method];
    let newPath = previous.qr_storage_path;
    try {
      if (draft.file) {
        if (!draft.file.type.startsWith('image/')) {
          throw new Error('Please choose an image file (PNG, JPG, etc.).');
        }
        const ext = draft.file.name.split('.').pop() || 'png';
        const objectPath = `${method.toLowerCase()}-${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('payment-qr')
          .upload(objectPath, draft.file, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
        newPath = uploadData.path;
      }

      const { error: updateError } = await supabase
        .from('payment_method_settings')
        .update({
          qr_storage_path: newPath,
          account_number: draft.accountNumber.trim() || null,
          account_name: draft.accountName.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('method', method);

      if (updateError) {
        if (draft.file && newPath && newPath !== previous.qr_storage_path) {
          await supabase.storage.from('payment-qr').remove([newPath]);
        }
        throw updateError;
      }

      if (draft.file && previous.qr_storage_path && previous.qr_storage_path !== newPath) {
        const { error: rmErr } = await supabase.storage.from('payment-qr').remove([previous.qr_storage_path]);
        if (rmErr) console.warn(`Could not remove old ${method} QR`, rmErr);
      }

      await fetchPaymentSettings();
      openNoticeModal('Payment details updated', `${method} payment details were updated successfully.`, 'success');
    } catch (error) {
      console.error(`Error saving ${method} payment settings`, error);
      openNoticeModal('Update failed', `Failed to save ${method} settings. Please try again.`, 'error');
    } finally {
      setSavingPaymentMethod(null);
    }
  };

  useEffect(() => {
    if (activeTab !== 'gcash') return;
    void fetchPaymentSettings();
  }, [activeTab, fetchPaymentSettings]);

  const fetchGameSettings = async () => {
    setGameLoading(true);
    try {
      const { data, error } = await supabase
        .from('game_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setGameSettings(data as GameSettings);
    } catch (error) {
      console.error('Error loading game settings', error);
    } finally {
      setGameLoading(false);
    }
  };

  const fetchAdmins = async () => {
    setAdminsLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAdmins((data || []) as AdminProfile[]);
    } catch (error) {
      console.error('Error loading admin profiles', error);
    } finally {
      setAdminsLoading(false);
    }
  };

  const fetchManagedUsers = async () => {
    setUsersLoading(true);
    try {
      const { data, error } = await supabase
        .from('customer_profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setManagedUsers((data || []) as CustomerProfile[]);
    } catch (error) {
      console.error('Error loading users', error);
    } finally {
      setUsersLoading(false);
    }
  };

  const openNoticeModal = (title: string, message: string, variant: 'success' | 'error' | 'info' = 'info') => {
    setNoticeModal({ open: true, title, message, variant });
  };

  const askConfirm = (
    title: string,
    message: string,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel'
  ) =>
    new Promise<boolean>((resolve) => {
      setConfirmModal({
        open: true,
        title,
        message,
        confirmLabel,
        cancelLabel,
        resolver: resolve,
      });
    });

  const closeConfirmModal = (result: boolean) => {
    setConfirmModal((prev) => {
      prev.resolver?.(result);
      return { ...prev, open: false, resolver: null };
    });
  };

  const suspendUser = async (customer: CustomerProfile, hours: number) => {
    try {
      const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from('customer_profiles')
        .update({
          suspended_until: until,
          suspension_reason: `Suspended by master admin for ${hours} hour(s).`,
        })
        .eq('id', customer.id);
      if (error) throw error;
      await fetchManagedUsers();
      openNoticeModal('User suspended', `User suspended until ${new Date(until).toLocaleString()}.`, 'success');
    } catch (error) {
      console.error('Error suspending user', error);
      openNoticeModal('Suspend failed', 'Failed to suspend user.', 'error');
    }
  };

  const unsuspendUser = async (customer: CustomerProfile) => {
    try {
      const { error } = await supabase
        .from('customer_profiles')
        .update({
          suspended_until: null,
          suspension_reason: null,
        })
        .eq('id', customer.id);
      if (error) throw error;
      await fetchManagedUsers();
    } catch (error) {
      console.error('Error unsuspending user', error);
      openNoticeModal('Unsuspend failed', 'Failed to remove suspension.', 'error');
    }
  };

  const deleteUserAccount = async (customer: CustomerProfile) => {
    const label = customer.username ? `@${customer.username}` : customer.full_name;
    const ok = await askConfirm(
      'Delete user account',
      `Delete user ${label}? This permanently removes customer account and related records.`,
      'Delete user',
      'Cancel'
    );
    if (!ok) {
      return;
    }
    try {
      const { error } = await supabase.rpc('master_admin_delete_customer_account', {
        p_user_id: customer.id,
      });
      if (error) throw error;
      await fetchManagedUsers();
      openNoticeModal('User deleted', 'User account deleted.', 'success');
    } catch (error) {
      console.error('Error deleting user account', error);
      openNoticeModal('Delete failed', 'Failed to delete user account.', 'error');
    }
  };

  const updateAdminActive = async (admin: AdminProfile, makeActive: boolean) => {
    try {
      if (admin.is_master_admin && !makeActive) {
        openNoticeModal('Action blocked', 'You cannot deactivate the Master Admin account.', 'info');
        return;
      }
      const { error } = await supabase
        .from('admin_profiles')
        .update({ is_active: makeActive })
        .eq('id', admin.id);
      if (error) throw error;
      await fetchAdmins();
    } catch (error) {
      console.error('Error updating admin approval status', error);
      openNoticeModal('Update failed', 'Failed to update admin status. Please try again.', 'error');
    }
  };

  const toggleFallingPizzaActive = async () => {
    if (!gameSettings) return;
    try {
      const { error } = await supabase
        .from('game_settings')
        .update({
          is_active: !(gameSettings.falling_pizza_active ?? gameSettings.is_active),
          falling_pizza_active: !(gameSettings.falling_pizza_active ?? gameSettings.is_active),
          updated_at: new Date().toISOString(),
        })
        .eq('id', gameSettings.id);

      if (error) throw error;
      await fetchGameSettings();
    } catch (error) {
      console.error('Error updating game settings', error);
    }
  };

  // Spin the Wheel game removed.

  const handleSelectTab = (tab: TabId) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    const ok = await askConfirm('Log out', 'Are you sure you want to log out?', 'Log out', 'Cancel');
    if (!ok) return;
    try {
      await signOut();
      window.location.reload();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const sidebarNav = (
    <div className="space-y-2">
      <button
        onClick={() => handleSelectTab('orders')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'orders'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <ClipboardList className="w-4 h-4" />
        Orders
      </button>
      <button
        onClick={() => handleSelectTab('archived')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'archived'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <Archive className="w-4 h-4" />
        Archived Orders
      </button>
      <button
        onClick={() => handleSelectTab('menu')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'menu'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <Pizza className="w-4 h-4" />
        Menu
      </button>
      <button
        onClick={() => handleSelectTab('announcements')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'announcements'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <Megaphone className="w-4 h-4" />
        Promos
      </button>
      <button
        onClick={() => handleSelectTab('gallery')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'gallery'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <ImageIcon className="w-4 h-4" />
        Gallery
      </button>
      {isMasterAdmin && (
        <button
          onClick={() => handleSelectTab('gcash')}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'gcash'
              ? 'bg-yellow-400 text-black shadow-lg'
              : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
          }`}
        >
          <QrCode className="w-4 h-4" />
          E-wallet Payments
        </button>
      )}
      <button
        onClick={() => handleSelectTab('game')}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          activeTab === 'game'
            ? 'bg-yellow-400 text-black shadow-lg'
            : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
        }`}
      >
        <Gamepad2 className="w-4 h-4" />
        Discount Game
      </button>
      {isMasterAdmin && (
        <button
          onClick={() => handleSelectTab('users')}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'users'
              ? 'bg-yellow-400 text-black shadow-lg'
              : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
          }`}
        >
          <Users className="w-4 h-4" />
          User Management
        </button>
      )}
      {isMasterAdmin && (
        <button
          onClick={() => handleSelectTab('admins')}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            activeTab === 'admins'
              ? 'bg-yellow-400 text-black shadow-lg'
              : 'bg-black/30 text-gray-200 hover:bg-neutral-800'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Admin Approvals
        </button>
      )}
    </div>
  );

  const handleSaveMenuItem = async () => {
    try {
      const price = Number(menuForm.price);
      const normalizedSubcategory = toTitleCase(menuForm.subcategory);
      const normalizedCategory = toTitleCase(menuForm.category);
      if (!menuForm.name || !menuForm.description || !Number.isFinite(price)) {
        openNoticeModal('Missing fields', 'Please fill out name, description, and a valid price.', 'info');
        return;
      }
      if (menuForm.description.trim().length > 100) {
        openNoticeModal('Description too long', 'Description must be 100 characters or less.', 'info');
        return;
      }
      if (!normalizedCategory) {
        openNoticeModal('Missing category', 'Please enter a main category.', 'info');
        return;
      }

      let imageUrl = menuForm.image_url;
      if (menuForm.imageFile) {
        const uploadFile = await compressImageBeforeUpload(menuForm.imageFile, {
          maxWidth: 1600,
          maxHeight: 1600,
          maxBytes: 900 * 1024,
          quality: 0.84,
        });
        const fileExt = uploadFile.name.split('.').pop();
        const fileName = `menu-${Date.now()}.${fileExt}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('menu')
          .upload(fileName, uploadFile);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('menu').getPublicUrl(uploadData.path);
        imageUrl = urlData.publicUrl;
      }

      const payload = {
        name: menuForm.name,
        description: menuForm.description.trim(),
        price,
        category: normalizedCategory,
        custom_category: null,
        subcategory: normalizedSubcategory || null,
        image_url: imageUrl,
      };

      if (!payload.image_url) {
        openNoticeModal('Image required', 'Please upload an image.', 'info');
        return;
      }

      if (editingMenuItem) {
        const { error } = await supabase.from('menu_items').update(payload).eq('id', editingMenuItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('menu_items').insert([{ ...payload, is_available: true }]);
        if (error) throw error;
      }

      setMenuModalOpen(false);
      setEditingMenuItem(null);
      await fetchMenuItems();
    } catch (error) {
      console.error('Error saving menu item', error);
      openNoticeModal('Save failed', 'Failed to save menu item. Please try again.', 'error');
    }
  };

  const handleConfirmDeleteMenuItem = async () => {
    if (!deleteMenuItem) return;
    setDeletingMenuItem(true);
    try {
      const { error } = await supabase.from('menu_items').delete().eq('id', deleteMenuItem.id);
      if (error) throw error;
      setDeleteMenuItem(null);
      await fetchMenuItems();
    } catch (error) {
      console.error('Error deleting menu item', error);
      openNoticeModal('Delete failed', 'Failed to delete product. Please try again.', 'error');
    } finally {
      setDeletingMenuItem(false);
    }
  };

  const noticeModalEl = noticeModal.open ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setNoticeModal((m) => ({ ...m, open: false }))}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-yellow-500/35 bg-neutral-950 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-yellow-500/20 flex items-center justify-between gap-3">
          <p
            className={`text-base font-bold ${
              noticeModal.variant === 'success'
                ? 'text-green-300'
                : noticeModal.variant === 'error'
                  ? 'text-red-300'
                  : 'text-yellow-300'
            }`}
          >
            {noticeModal.title}
          </p>
          <button
            type="button"
            onClick={() => setNoticeModal((m) => ({ ...m, open: false }))}
            className="p-1.5 rounded-lg text-gray-300 hover:bg-white/10"
            aria-label="Close notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-200">{noticeModal.message}</p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setNoticeModal((m) => ({ ...m, open: false }))}
              className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-all"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;
  const confirmModalEl = confirmModal.open ? (
    <div className="fixed inset-0 z-[85] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => closeConfirmModal(false)} />
      <div className="relative w-full max-w-md rounded-2xl border border-yellow-500/35 bg-neutral-950 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-yellow-500/20 flex items-center justify-between gap-3">
          <p className="text-base font-bold text-yellow-300">{confirmModal.title}</p>
          <button
            type="button"
            onClick={() => closeConfirmModal(false)}
            className="p-1.5 rounded-lg text-gray-300 hover:bg-white/10"
            aria-label="Close confirmation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-200">{confirmModal.message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => closeConfirmModal(false)}
              className="px-4 py-2 rounded-lg border border-yellow-500/35 text-gray-100 hover:bg-white/10 transition-all"
            >
              {confirmModal.cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => closeConfirmModal(true)}
              className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-all"
            >
              {confirmModal.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-black to-neutral-900 pb-8">
      {noticeModalEl}
      {confirmModalEl}
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-black/80 backdrop-blur border-b border-yellow-500/20">
        <div className="w-full px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 md:h-12 md:w-12 rounded-full border-2 border-yellow-400 overflow-hidden bg-black">
              <img
                src="/assets/kaedypizza.jpg"
                alt="KaeDy's Pizza Hub Logo"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="leading-tight">
              <p className="text-base md:text-lg font-bold text-yellow-300">KaeDy&apos;s Pizza Hub</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] md:text-xs text-gray-400">
                  {adminProfile?.full_name ? `Admin: ${adminProfile.full_name}` : 'Admin Dashboard'}
                </p>
                {adminProfile?.full_name && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      adminProfile?.is_master_admin
                        ? 'bg-yellow-400/15 text-yellow-200 border-yellow-500/40'
                        : 'bg-neutral-800 text-gray-200 border-neutral-700'
                    }`}
                  >
                    {adminProfile?.is_master_admin ? 'MASTER ADMIN' : 'ADMIN'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center rounded-lg p-2 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10 transition-all"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile side drawer menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-30 flex">
            {/* Backdrop */}
            <button
              type="button"
              className="flex-1 bg-black/80 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Drawer */}
            <div className="w-72 max-w-[80%] bg-gradient-to-b from-black to-neutral-900 border-l border-yellow-500/40 shadow-[0_0_25px_rgba(0,0,0,0.8)] p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full border-2 border-yellow-400 overflow-hidden bg-black">
                    <img
                      src="/assets/kaedypizza.jpg"
                      alt="KaeDy's Pizza Hub Logo"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="leading-tight">
                    <p className="text-base font-bold text-yellow-300">KaeDy&apos;s Pizza Hub</p>
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-gray-400 truncate max-w-[165px]">
                        {adminProfile?.full_name ? adminProfile.full_name : 'Admin'}
                      </p>
                      {adminProfile?.full_name && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            adminProfile?.is_master_admin
                              ? 'bg-yellow-400/15 text-yellow-200 border-yellow-500/40'
                              : 'bg-neutral-800 text-gray-200 border-neutral-700'
                          }`}
                        >
                          {adminProfile?.is_master_admin ? 'MASTER' : 'ADMIN'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full p-1.5 text-gray-300 hover:bg-yellow-500/20 hover:text-yellow-300 transition-all"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-1 space-y-2 rounded-2xl bg-black/40 border border-yellow-500/30 p-2">
                <button
                  onClick={() => handleSelectTab('orders')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'orders'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4" />
                    Orders
                  </span>
                </button>
                <button
                  onClick={() => handleSelectTab('archived')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'archived'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Archive className="w-4 h-4" />
                    Archived Orders
                  </span>
                </button>

                <button
                  onClick={() => handleSelectTab('menu')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'menu'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Pizza className="w-4 h-4" />
                    Menu
                  </span>
                </button>

                <button
                  onClick={() => handleSelectTab('announcements')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'announcements'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Megaphone className="w-4 h-4" />
                    Promos & Announcements
                  </span>
                </button>

                <button
                  onClick={() => handleSelectTab('gallery')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'gallery'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" />
                    Gallery
                  </span>
                </button>

                {isMasterAdmin && (
                  <button
                    onClick={() => handleSelectTab('gcash')}
                    className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                      activeTab === 'gcash'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-neutral-800 text-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <QrCode className="w-4 h-4" />
                      E-wallet Payments
                    </span>
                  </button>
                )}

                <button
                  onClick={() => handleSelectTab('game')}
                  className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                    activeTab === 'game'
                      ? 'bg-yellow-400 text-black'
                      : 'bg-neutral-800 text-gray-100'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4" />
                    Discount Game
                  </span>
                </button>
                {isMasterAdmin && (
                  <button
                    onClick={() => handleSelectTab('users')}
                    className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                      activeTab === 'users'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-neutral-800 text-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Users
                    </span>
                  </button>
                )}
                {isMasterAdmin && (
                  <button
                    onClick={() => handleSelectTab('admins')}
                    className={`w-full inline-flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold ${
                      activeTab === 'admins'
                        ? 'bg-yellow-400 text-black'
                        : 'bg-neutral-800 text-gray-100'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4" />
                      Admins
                    </span>
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="w-full px-4 md:px-6 pt-6">
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden md:flex w-64 shrink-0">
            <div className="w-full sticky top-[88px] h-[calc(100vh-104px)] rounded-2xl border border-yellow-500/25 bg-black/30 p-3 flex flex-col">
              <p className="text-xs font-semibold text-gray-400 px-2 py-2">Navigation</p>
              {sidebarNav}
              <div className="mt-auto pt-4">
                <button
                  onClick={handleLogout}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-all"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="mb-6">
              <h1 className="text-2xl md:text-3xl font-bold text-yellow-300 mb-1">
                Admin Dashboard
              </h1>
              <p className="text-gray-300 text-sm md:text-base">
                Manage orders, menu availability, promotions, gallery, and the discount game.
              </p>
            </div>

        {menuModalOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-lg bg-neutral-900 rounded-2xl border border-yellow-500/30 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-yellow-500/20">
                <h3 className="text-lg font-bold text-yellow-300">
                  {editingMenuItem ? 'Edit Product' : 'Add Product'}
                </h3>
                <button
                  onClick={() => setMenuModalOpen(false)}
                  className="p-2 rounded-lg text-gray-300 hover:bg-yellow-500/10 hover:text-yellow-300 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Main category</label>
                  <input
                    type="text"
                    value={menuForm.category}
                    onChange={(e) => setMenuForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-black text-white border border-yellow-500/30"
                    placeholder="e.g. Pizza, Drinks, Silog Meals"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">
                    Subcategory (optional)
                  </label>
                  <input
                    value={menuForm.subcategory}
                    onChange={(e) => setMenuForm((p) => ({ ...p, subcategory: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-black text-white border border-yellow-500/30"
                    placeholder="e.g. Milktea, Fruit Soda"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Product name</label>
                  <input
                    value={menuForm.name}
                    onChange={(e) => setMenuForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-black text-white border border-yellow-500/30"
                    placeholder="e.g. Pepperoni Pizza"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-1">Short description</label>
                  <textarea
                    value={menuForm.description}
                    onChange={(e) =>
                      setMenuForm((p) => ({ ...p, description: e.target.value.slice(0, 100) }))
                    }
                    maxLength={100}
                    className="w-full px-3 py-2 rounded-lg bg-black text-white border border-yellow-500/30"
                    rows={3}
                    placeholder="Write a short description"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    {menuForm.description.length}/100 characters
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-1">Price (₱)</label>
                    <input
                      value={menuForm.price}
                      onChange={(e) => setMenuForm((p) => ({ ...p, price: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-black text-white border border-yellow-500/30"
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-1">Image</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setMenuForm((p) => ({ ...p, imageFile: e.target.files?.[0] || null }))}
                      className="w-full text-sm text-gray-200"
                    />
                  </div>
                </div>
                {(menuForm.image_url || menuForm.imageFile) && (
                  <div className="rounded-xl overflow-hidden border border-yellow-500/20 bg-black/40">
                    <img
                      src={menuForm.imageFile ? URL.createObjectURL(menuForm.imageFile) : menuForm.image_url}
                      alt="Preview"
                      className="w-full h-40 object-cover"
                    />
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-yellow-500/20 flex gap-3 justify-end">
                <button
                  onClick={() => setMenuModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-neutral-800 text-gray-200 font-semibold hover:bg-neutral-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMenuItem}
                  className="px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {!!deleteMenuItem && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-md bg-neutral-900 rounded-2xl border border-yellow-500/30 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-yellow-500/20">
                <h3 className="text-lg font-bold text-yellow-300">Remove product</h3>
                <button
                  type="button"
                  onClick={() => (deletingMenuItem ? null : setDeleteMenuItem(null))}
                  className="p-2 rounded-lg text-gray-300 hover:bg-yellow-500/10 hover:text-yellow-300 transition-all disabled:opacity-50"
                  disabled={deletingMenuItem}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-200">
                  Are you sure you want to remove{' '}
                  <span className="font-semibold text-yellow-200">{deleteMenuItem.name}</span>?
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  This will permanently delete the product from the database. This action cannot be undone.
                </p>

                <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setDeleteMenuItem(null)}
                    disabled={deletingMenuItem}
                    className="px-4 py-2.5 rounded-xl bg-neutral-800 text-gray-200 text-sm font-semibold hover:bg-neutral-700 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDeleteMenuItem}
                    disabled={deletingMenuItem}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-all disabled:opacity-50"
                  >
                    {deletingMenuItem ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-yellow-400" />
                <h2 className="text-xl font-bold text-yellow-300">Recent Orders</h2>
              </div>
              <button
                type="button"
                onClick={markAllOrdersCompleted}
                disabled={markingAllCompleted}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-green-700 text-white hover:bg-green-600 transition-all disabled:opacity-60"
              >
                {markingAllCompleted ? 'Processing...' : 'Mark all as completed'}
              </button>
            </div>
            {ordersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No orders yet.</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => {
                  const customer = customersById[order.user_id];
                  const instructionNotes = extractCustomerInstructionFromNotes(order.notes);
                  return (
                  <div
                    key={order.id}
                    className="border border-yellow-500/20 rounded-2xl p-4 md:p-5 hover:shadow-md transition-all bg-black/40"
                  >
                    <div className="grid gap-4 lg:grid-cols-[3fr_7fr]">
                      {/* Left: customer info */}
                      <div className="rounded-2xl border border-yellow-500/20 bg-black/30 p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <p className="text-base font-bold text-yellow-200">Customer Information</p>
                          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold border border-yellow-500/40 bg-black/40 text-gray-200">
                            {order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                            <p className="text-[11px] font-semibold text-gray-400">Name</p>
                            <p className="mt-1 text-gray-100 font-semibold leading-snug break-words">
                              {customer?.full_name || 'Unknown customer'}
                            </p>
                          </div>

                          <div className="rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                            <p className="text-[11px] font-semibold text-gray-400">Email</p>
                            <p className="mt-1 text-gray-200 leading-snug break-words">
                              {customer?.email || 'No email'}
                            </p>
                          </div>

                          <div className="rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                            <p className="text-[11px] font-semibold text-gray-400">Contact no.</p>
                            <p className="mt-1 text-gray-100 leading-snug break-words">
                              {order.contact_phone || customer?.phone || 'No phone'}
                            </p>
                          </div>

                          <div className="rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                            <p className="text-[11px] font-semibold text-gray-400">Address</p>
                            <p className="mt-1 text-gray-200 leading-snug break-words">
                              {order.delivery_address || customer?.address || 'No address provided'}
                            </p>
                          </div>

                          {instructionNotes ? (
                            <div className="rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                              <p className="text-[11px] font-semibold text-gray-400">
                                Special instructions
                              </p>
                              <p className="mt-1 text-sm text-gray-200 whitespace-pre-wrap break-words">
                                {instructionNotes}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Right: order details */}
                      <div className="rounded-2xl border border-yellow-500/20 bg-black/30 p-4 flex flex-col">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0">
                            <p className="text-base font-bold text-yellow-200">
                              Order #{order.id.slice(0, 8)}
                            </p>
                            <p className="text-sm text-gray-400">
                              {new Date(order.created_at).toLocaleString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 bg-black/30 text-gray-200">
                            {order.payment_method}
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-gray-400">Status</span>
                            <select
                              value={order.status}
                              onChange={(e) => updateOrderStatus(order, e.target.value as Order['status'])}
                              className="text-sm font-semibold border border-yellow-500/35 rounded-xl px-3 py-2 bg-black/50 text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                            >
                              {STATUS_LABELS.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {order.payment_method === 'GCash' && (
                          <div className="mt-3 rounded-xl border border-yellow-500/15 bg-black/25 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-gray-300 mb-1">GCash Payment Details</p>
                                <p className="text-[11px] font-semibold text-gray-400">Reference Number</p>
                                <p className="mt-1 text-sm font-semibold text-yellow-200 break-words">
                                  {order.payment_reference || '—'}
                                </p>
                              </div>

                              {order.payment_proof_url ? (
                                <a
                                  href={order.payment_proof_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0"
                                  aria-label="View payment proof"
                                  title="Click to view full payment proof"
                                >
                                  <img
                                    src={order.payment_proof_url}
                                    alt="Payment proof"
                                    className="w-24 h-24 object-contain rounded-lg border border-white/10 bg-black/60 hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              ) : (
                                <p className="text-[11px] text-gray-500 mt-1">No proof uploaded</p>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="mt-4 rounded-xl border border-yellow-500/15 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-xs font-semibold text-gray-300">Items</p>
                            <p className="text-xs text-gray-500">
                              {order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                            {order.order_items.map((item) => {
                              const menuItem = menuItems.find((m) => m.id === item.menu_item_id);
                              return (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-3 rounded-lg bg-black/40 px-2 py-2"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    {menuItem && (
                                      <img
                                        src={menuItem.image_url}
                                        alt={item.menu_item_name}
                                        className="w-16 h-16 rounded-lg object-cover border border-yellow-500/30"
                                      />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-sm text-gray-100 leading-snug break-words">
                                        <span className="text-gray-300 font-semibold">{item.quantity}×</span>{' '}
                                        {item.menu_item_name}
                                      </p>
                                      <p className="text-[11px] text-gray-400">
                                        ₱{item.price.toFixed(2)} each
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-sm font-semibold text-yellow-200 whitespace-nowrap">
                                    ₱{item.subtotal.toFixed(2)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Bottom summary */}
                        <div className="mt-4 pt-4 border-t border-yellow-500/15 flex items-end justify-between gap-3">
                          <div className="text-xs text-gray-400">
                            <p>Summary</p>
                            {order.discount_amount > 0 ? (
                              <p className="text-[11px] text-green-300/90 mt-1">
                                Discount: -₱{order.discount_amount.toFixed(2)}
                              </p>
                            ) : (
                              <p className="text-[11px] text-gray-500 mt-1">No discount</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400">Total</p>
                            <p className="text-xl font-extrabold text-yellow-300 leading-tight">
                              ₱{order.final_amount.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </section>
        )}

        {activeTab === 'archived' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <Archive className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">Archived Orders</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Completed orders are auto-archived and automatically deleted after 3 days.
            </p>

            {archivedOrdersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : archivedOrders.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No archived orders yet.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-col gap-3 rounded-xl border border-yellow-500/15 bg-black/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-200">
                    <span className="font-semibold text-yellow-300">{selectedArchivedOrderIds.size}</span> selected
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllArchivedOrders}
                      className="px-3 py-1.5 rounded text-xs font-semibold border border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/10 transition-colors"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={clearArchivedSelection}
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-neutral-800 text-gray-100 hover:bg-neutral-700 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelectedArchivedOrders}
                      disabled={selectedArchivedOrderIds.size === 0 || deletingSelectedArchivedOrders}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold bg-red-700 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingSelectedArchivedOrders ? 'Deleting...' : 'Delete selected'}
                    </button>
                  </div>
                </div>
                {archivedOrders.map((order) => {
                  const customer = customersById[order.user_id];
                  return (
                    <div
                      key={order.id}
                      className="border border-yellow-500/20 rounded-lg px-3 py-2 bg-black/35"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1.1fr_0.9fr_0.8fr] items-center gap-3">
                        <div className="min-w-0 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedArchivedOrderIds.has(order.id)}
                            onChange={() => toggleSelectArchivedOrder(order.id)}
                            className="h-4 w-4 accent-yellow-400 shrink-0"
                            aria-label={`Select archived order ${order.id.slice(0, 8)}`}
                          />
                          <p className="text-sm font-bold text-yellow-200 whitespace-nowrap">#{order.id.slice(0, 8)}</p>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/20 text-green-300 border border-green-500/40 whitespace-nowrap">
                            Completed
                          </span>
                        </div>
                        <p className="text-xs text-gray-300 truncate">
                          {customer?.full_name || 'Unknown'} {customer?.email ? `(${customer.email})` : ''}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          Archived: {order.archived_at ? new Date(order.archived_at).toLocaleString() : '—'}
                        </p>
                        <div className="flex items-center gap-3 lg:justify-end">
                          <p className="text-xs text-gray-300">
                            <span className="text-gray-500">Payment:</span> {order.payment_method}
                          </p>
                          <p className="text-base font-bold text-yellow-300 whitespace-nowrap">₱{order.final_amount.toFixed(2)}</p>
                          <button
                            type="button"
                            onClick={() => deleteArchivedOrder(order)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-700 text-white hover:bg-red-600 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'menu' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
              <Pizza className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">Menu Availability</h2>
              </div>
              <button
                onClick={() => {
                  setEditingMenuItem(null);
                  setMenuForm({
                    category: '',
                    custom_category: '',
                    subcategory: '',
                    name: '',
                    description: '',
                    price: '',
                    imageFile: null,
                    image_url: '',
                  });
                  setMenuModalOpen(true);
                }}
                className="px-4 py-2 rounded-lg bg-yellow-400 text-black text-sm font-semibold hover:bg-yellow-300 transition-all"
              >
                + Add Product
              </button>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Add, edit, and toggle availability. The public menu is loaded from the database.
            </p>

            <div className="flex flex-col lg:flex-row lg:items-end gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-400 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                    placeholder="Search by name, description, price..."
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-yellow-500/25 bg-black/40 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
                  />
                  {menuSearch.trim() && (
                    <button
                      type="button"
                      onClick={() => setMenuSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10"
                      aria-label="Clear search"
                      title="Clear"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="w-full lg:w-64">
                <label className="block text-xs font-semibold text-gray-400 mb-1">Category</label>
                <AdminCategoryDropdown
                  value={menuCategory}
                  onChange={setMenuCategory}
                  options={filterCategoryOptions}
                />
              </div>

              <div className="flex items-center gap-2 lg:ml-auto">
                <span className="text-xs text-gray-400">Showing</span>
                <span className="px-2 py-1 rounded-full text-xs font-semibold bg-yellow-400/15 text-yellow-200 border border-yellow-500/30">
                  {filteredMenuItems.length}/{menuItems.length}
                </span>
              </div>
            </div>
            {menuLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : menuItems.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No menu items yet.</p>
            ) : filteredMenuItems.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No matching products.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filteredMenuItems.map((item) => (
                  <div
                    key={item.id}
                    className="border border-yellow-500/20 rounded-lg p-4 bg-black/40 flex flex-col gap-4"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-[112px_1fr] gap-4">
                      <div className="w-full lg:w-28 lg:shrink-0">
                        <div className="relative aspect-square rounded-lg overflow-hidden border border-yellow-500/20 bg-black/40">
                          <img
                            src={item.image_url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                          <span
                            className={`absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border backdrop-blur ${
                              item.is_available
                                ? 'bg-green-900/80 text-green-100 border-green-400/80'
                                : 'bg-red-900/80 text-red-100 border-red-400/80'
                            }`}
                          >
                            {item.is_available ? 'Available' : 'Unavailable'}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-yellow-300 leading-tight line-clamp-2 break-words">
                              {item.name}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {item.category === 'Others'
                                ? item.custom_category || 'Others'
                                : item.category}
                            </p>
                            {!!item.subcategory && (
                              <p className="text-[11px] text-yellow-200/80 truncate">
                                {item.subcategory}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-base text-gray-100 font-bold">
                            ₱{Number(item.price).toFixed(2)}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-gray-300 break-words">
                          {item.description.length > 100
                            ? `${item.description.slice(0, 100).trimEnd()}...`
                            : item.description}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        onClick={() => toggleMenuAvailability(item)}
                        className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                          item.is_available
                            ? 'bg-red-600 text-white hover:bg-red-500'
                            : 'bg-green-600 text-white hover:bg-green-500'
                        }`}
                      >
                        {item.is_available ? 'Mark as Unavailable' : 'Mark as Available'}
                      </button>
                      <button
                        onClick={() => {
                          const resolvedCategory =
                            item.category === 'Others'
                              ? item.custom_category?.trim() || 'Others'
                              : item.category;
                          setEditingMenuItem(item);
                          setMenuForm({
                            category: resolvedCategory,
                            custom_category: '',
                            subcategory: item.subcategory || '',
                            name: item.name,
                            description: item.description,
                            price: String(item.price),
                            imageFile: null,
                            image_url: item.image_url,
                          });
                          setMenuModalOpen(true);
                        }}
                        className="px-2.5 py-1.5 rounded-md text-[15px] font-semibold bg-yellow-400 text-black hover:bg-yellow-300 transition-all"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteMenuItem(item)}
                        className="px-2.5 py-1.5 rounded-md text-[13px] font-semibold bg-red-500/15 text-red-200 border border-red-500/30 hover:bg-red-500/25 transition-all"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'announcements' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <Megaphone className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">
                Promos & Announcements
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="md:col-span-1 border border-dashed border-yellow-500/60 rounded-lg p-4 bg-black/40">
                <h3 className="font-semibold text-yellow-300 mb-2">New promo</h3>
                <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                  Choose where this promo appears on the customer home page:
                </p>
                <ul className="text-[11px] text-gray-500 mb-3 list-disc pl-4 space-y-1 leading-snug">
                  <li>
                    <span className="text-gray-400">Promo update</span> — the promo card (megaphone) and the
                    announcements list on large screens.
                  </li>
                  <li>
                    <span className="text-gray-400">Promo sliding text</span> — a scrolling line across the{' '}
                    <span className="text-gray-400">top of the store photo</span>.
                  </li>
                </ul>
                <div className="mb-3 space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-yellow-500/20 bg-black/30 p-2 text-sm text-gray-200 hover:border-yellow-500/40">
                    <input
                      type="radio"
                      name="promo_type"
                      className="mt-1 accent-yellow-400"
                      checked={newAnnouncement.promo_type === 'card'}
                      onChange={() =>
                        setNewAnnouncement((prev) => ({ ...prev, promo_type: 'card' }))
                      }
                    />
                    <span>Promo update (card and announcements)</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-yellow-500/20 bg-black/30 p-2 text-sm text-gray-200 hover:border-yellow-500/40">
                    <input
                      type="radio"
                      name="promo_type"
                      className="mt-1 accent-yellow-400"
                      checked={newAnnouncement.promo_type === 'marquee'}
                      onChange={() =>
                        setNewAnnouncement((prev) => ({ ...prev, promo_type: 'marquee', cardImageFile: null }))
                      }
                    />
                    <span>Promo sliding text (top of store photo)</span>
                  </label>
                </div>
                {newAnnouncement.promo_type === 'card' && (
                  <div className="mb-2">
                    <label className="block text-[11px] text-gray-400 mb-1">
                      Optional card image (shown behind title &amp; details on the customer home page)
                    </label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      onChange={(e) =>
                        setNewAnnouncement((prev) => ({
                          ...prev,
                          cardImageFile: e.target.files?.[0] || null,
                        }))
                      }
                      className="w-full text-xs text-gray-200"
                    />
                    {newAnnouncement.cardImageFile ? (
                      <p className="text-[10px] text-gray-500 mt-1 truncate">
                        Selected: {newAnnouncement.cardImageFile.name}
                      </p>
                    ) : null}
                  </div>
                )}
                <input
                  type="text"
                  value={newAnnouncement.title}
                  onChange={(e) =>
                    setNewAnnouncement((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder={
                    newAnnouncement.promo_type === 'marquee'
                      ? 'Short heading (optional)'
                      : 'Promo title'
                  }
                  className="w-full mb-2 px-3 py-2 border border-yellow-500/40 rounded-lg text-sm bg-black text-white"
                />
                <textarea
                  value={newAnnouncement.content}
                  onChange={(e) =>
                    setNewAnnouncement((prev) => ({ ...prev, content: e.target.value }))
                  }
                  placeholder={
                    newAnnouncement.promo_type === 'marquee'
                      ? 'Text for the sliding line (required)'
                      : 'Full promo details'
                  }
                  rows={4}
                  className="w-full mb-3 px-3 py-2 border border-yellow-500/40 rounded-lg text-sm bg-black text-white"
                />
                <button
                  type="button"
                  onClick={createAnnouncement}
                  className="w-full bg-yellow-400 text-black py-2 rounded-lg text-sm font-semibold hover:bg-yellow-300 transition-all"
                >
                  Post promo
                </button>
              </div>

              <div className="md:col-span-2">
                {annLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
                  </div>
                ) : announcements.length === 0 ? (
                  <p className="text-gray-300 text-center py-6">
                    No announcements yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {announcements.map((a) => (
                      <div
                        key={a.id}
                        className="border border-yellow-500/20 rounded-lg p-3 flex items-start justify-between gap-3 bg-black/40"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                                a.promo_type === 'marquee'
                                  ? 'bg-amber-500/15 text-amber-200 border-amber-500/35'
                                  : 'bg-yellow-500/15 text-yellow-200 border-yellow-500/35'
                              }`}
                            >
                              {a.promo_type === 'marquee' ? 'Promo sliding text' : 'Promo update'}
                            </span>
                          </div>
                          {a.promo_type !== 'marquee' && a.card_image_path ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <img
                                src={promoCardImagePublicUrl(a.card_image_path, a.created_at) || ''}
                                alt=""
                                className="h-14 w-24 object-cover rounded border border-yellow-500/25"
                              />
                              <button
                                type="button"
                                onClick={() => removeAnnouncementCardImage(a)}
                                disabled={removingCardImageId === a.id}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold bg-neutral-800 text-amber-200 border border-yellow-500/30 hover:bg-neutral-700 disabled:opacity-50"
                              >
                                {removingCardImageId === a.id ? 'Removing…' : 'Delete image'}
                              </button>
                            </div>
                          ) : null}
                          <p className="font-semibold text-yellow-300">{a.title}</p>
                          <p className="text-sm text-gray-200">{a.content}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(a.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="flex flex-wrap items-center justify-end gap-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-extrabold uppercase tracking-wide ${
                                  a.active ? 'text-gray-600' : 'text-yellow-300'
                                }`}
                              >
                                Off
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={a.active}
                                aria-label={a.active ? 'Turn off — hide from customers' : 'Turn on — show to customers'}
                                onClick={() => toggleAnnouncementActive(a)}
                                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/70 ${
                                  a.active ? 'bg-green-600' : 'bg-neutral-600'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    a.active ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                              <span
                                className={`text-[10px] font-extrabold uppercase tracking-wide ${
                                  a.active ? 'text-green-300' : 'text-gray-600'
                                }`}
                              >
                                On
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteAnnouncement(a)}
                              className="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-red-500/15 text-red-200 border border-red-500/30 hover:bg-red-500/25 transition-all"
                            >
                              Delete
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-500 text-right max-w-[14rem] leading-tight">
                            {a.active ? 'Visible on site' : 'Hidden from site'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'gallery' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <ImageIcon className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">Gallery Images</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Upload up to <strong>10</strong> photos. These appear in the public gallery
              carousel.
            </p>

            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleGalleryUpload(e.target.files?.[0] || null)}
                className="w-full md:w-auto text-sm text-gray-200"
                disabled={uploadingImage}
              />
              <p className="text-xs text-gray-400">
                {galleryImages.length}/10 images uploaded
              </p>
            </div>

            {galleryLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : galleryImages.length === 0 ? (
              <p className="text-gray-300 text-center py-6">
                No images yet. Upload your first gallery photo.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {galleryImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-lg overflow-hidden bg-black/40 border border-yellow-500/30"
                  >
                    <img
                      src={img.image_url}
                      alt="Gallery"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {isMasterAdmin && activeTab === 'gcash' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <QrCode className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">E-wallet Payments</h2>
            </div>
            <p className="text-sm text-gray-300 mb-2">
              Set QR code, <strong className="text-yellow-200">account name</strong>, and{' '}
              <strong className="text-yellow-200">account number</strong> for GCash, Maya, and PayPal. Customers will
              see these details at checkout.
            </p>
            <p className="text-xs text-gray-500 mb-6">
              Security: only <strong className="text-gray-400">active master admin</strong> can upload/delete wallet QR
              and update account name and number.
            </p>

            {paymentsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {WALLET_METHODS.map((method) => {
                  const setting = paymentSettings[method];
                  const draft = paymentDrafts[method];
                  const preview = paymentPreviewUrls[method];
                  const isSaving = savingPaymentMethod === method;
                  return (
                    <div key={method} className="rounded-xl border border-yellow-500/20 bg-black/35 p-4">
                      <h3 className="text-lg font-bold text-yellow-200">{method}</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        Updated: {new Date(setting.updated_at).toLocaleString()}
                      </p>

                      <div className="mt-3 rounded-lg border border-yellow-500/20 bg-black/40 p-3 text-center">
                        {preview ? (
                          <img
                            src={preview}
                            alt={`${method} QR preview`}
                            className="w-40 h-40 object-contain rounded-lg mx-auto border border-white/10 bg-black/60"
                          />
                        ) : (
                          <div className="w-40 h-40 mx-auto rounded-lg border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs px-2">
                            No QR uploaded yet
                          </div>
                        )}
                      </div>

                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Account name</label>
                          <input
                            type="text"
                            value={draft.accountName}
                            onChange={(e) =>
                              setPaymentDrafts((prev) => ({
                                ...prev,
                                [method]: { ...prev[method], accountName: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-2 rounded-lg bg-black border border-yellow-500/35 text-white text-sm"
                            placeholder="Name registered on this wallet"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Account number</label>
                          <input
                            type="text"
                            value={draft.accountNumber}
                            onChange={(e) =>
                              setPaymentDrafts((prev) => ({
                                ...prev,
                                [method]: { ...prev[method], accountNumber: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-2 rounded-lg bg-black border border-yellow-500/35 text-white text-sm"
                            placeholder={`${method} mobile no. or account no.`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Upload QR image</label>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                            onChange={(e) =>
                              setPaymentDrafts((prev) => ({
                                ...prev,
                                [method]: { ...prev[method], file: e.target.files?.[0] || null },
                              }))
                            }
                            className="w-full text-xs text-gray-200"
                          />
                        </div>
                        <button
                          onClick={() => savePaymentMethod(method)}
                          disabled={isSaving}
                          className="w-full px-3 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 disabled:opacity-60 transition-all text-sm"
                        >
                          {isSaving ? 'Saving...' : `Save ${method}`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'game' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <Gamepad2 className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">Discount Game</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Toggle each discount game on or off for all customers.
            </p>

            {gameLoading || !gameSettings ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-yellow-500/20 bg-black/30 p-3">
                  <div>
                    <p className="font-semibold text-gray-200">
                      Math Challenge is{' '}
                      <span
                        className={
                          (gameSettings.falling_pizza_active ?? gameSettings.is_active)
                            ? 'text-green-400'
                            : 'text-red-400'
                        }
                      >
                        {(gameSettings.falling_pizza_active ?? gameSettings.is_active) ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Last updated: {new Date(gameSettings.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={toggleFallingPizzaActive}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                      (gameSettings.falling_pizza_active ?? gameSettings.is_active)
                        ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30'
                        : 'bg-green-500/20 text-green-200 hover:bg-green-500/30'
                    }`}
                  >
                    {(gameSettings.falling_pizza_active ?? gameSettings.is_active) ? 'Disable' : 'Enable'}
                  </button>
                </div>

                {/* Spin the Wheel game removed */}
              </div>
            )}
          </section>
        )}

        {isMasterAdmin && activeTab === 'users' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">User Management</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Master admin can view full customer details, temporarily suspend accounts, or permanently delete customer accounts.
            </p>

            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : managedUsers.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No customer users found.</p>
            ) : (
              <div className="space-y-3">
                {managedUsers.map((customer) => {
                  const suspendedUntil = customer.suspended_until ? new Date(customer.suspended_until) : null;
                  const isSuspended = !!suspendedUntil && suspendedUntil.getTime() > Date.now();
                  return (
                    <details
                      key={customer.id}
                      className="group rounded-xl border border-yellow-500/25 bg-black/35 p-3 open:border-yellow-400/50"
                    >
                      <summary className="list-none cursor-pointer">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-yellow-200 truncate">
                              {customer.full_name || 'Unnamed user'}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {customer.username ? `@${customer.username}` : 'No username'} • {customer.email || 'No email'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded-full text-[11px] font-semibold border ${
                                isSuspended
                                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                  : 'bg-green-500/20 text-green-300 border-green-500/40'
                              }`}
                            >
                              {isSuspended ? 'Suspended' : 'Active'}
                            </span>
                            <ChevronDown className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" />
                          </div>
                        </div>
                      </summary>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Full Name</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">{customer.full_name || '—'}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Username</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">{customer.username ? `@${customer.username}` : '—'}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Email</p>
                          <p className="text-sm text-gray-100 mt-1 break-all">{customer.email || '—'}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Phone</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">{customer.phone || '—'}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3 md:col-span-2">
                          <p className="text-[11px] text-gray-400 font-semibold">Address</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">{customer.address || '—'}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Registered</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">{new Date(customer.created_at).toLocaleString()}</p>
                        </div>
                        <div className="rounded-lg border border-yellow-500/15 bg-black/30 p-3">
                          <p className="text-[11px] text-gray-400 font-semibold">Suspension</p>
                          <p className="text-sm text-gray-100 mt-1 break-words">
                            {isSuspended && suspendedUntil
                              ? `Until ${suspendedUntil.toLocaleString()}`
                              : 'Not suspended'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {isSuspended ? (
                          <button
                            onClick={() => unsuspendUser(customer)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition-all"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            Unsuspend
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => suspendUser(customer, 24)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-500 transition-all"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Suspend 24h
                            </button>
                            <button
                              onClick={() => suspendUser(customer, 24 * 7)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-700 text-white hover:bg-red-600 transition-all"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Suspend 7 days
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => deleteUserAccount(customer)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-red-900 text-white hover:bg-red-800 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete User
                        </button>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {isMasterAdmin && activeTab === 'admins' && (
          <section className="bg-neutral-900 rounded-xl shadow-lg p-4 md:p-6 border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardList className="w-5 h-5 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-300">Admin Accounts</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Approve or decline admin access. Only the Master Admin can manage these accounts.
            </p>

            {adminsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
              </div>
            ) : admins.length === 0 ? (
              <p className="text-gray-300 text-center py-6">No admin accounts found.</p>
            ) : (
              <div className="space-y-3">
                {admins.map((admin) => (
                  <div
                    key={admin.id}
                    className="border border-yellow-500/20 rounded-lg p-3 bg-black/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-yellow-300">
                        {admin.full_name}{' '}
                        {admin.is_master_admin && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-yellow-400 text-black">
                            MASTER ADMIN
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-300">{admin.email}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Registered:{' '}
                        {new Date(admin.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded-full text-[11px] font-semibold ${
                          admin.is_active
                            ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                            : 'bg-red-500/20 text-red-300 border border-red-500/40'
                        }`}
                      >
                        {admin.is_active ? 'Approved' : 'Pending'}
                      </span>
                      {!admin.is_master_admin && (
                        <div className="flex gap-2">
                          {!admin.is_active ? (
                            <>
                              <button
                                onClick={() => updateAdminActive(admin, true)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition-all"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateAdminActive(admin, false)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-700 text-white hover:bg-red-600 transition-all"
                              >
                                Decline
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => updateAdminActive(admin, false)}
                              className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-700 text-white hover:bg-red-600 transition-all"
                            >
                              Disable
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

