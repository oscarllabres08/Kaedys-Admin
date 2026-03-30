import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const kind = import.meta.env.VITE_APP_KIND;
const isAdminApp =
  kind === 'admin' ||
  (kind !== 'user' &&
    typeof document !== 'undefined' &&
    document.getElementById('admin-root') !== null);

// Use different auth storage keys so admin/public sessions don't overwrite each other
// when opened in different tabs of the same browser.
const storageKey = isAdminApp ? 'kaedys_sb_admin_auth' : 'kaedys_sb_public_auth';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type CustomerProfile = {
  id: string;
  full_name: string;
  username?: string | null;
  phone: string;
  address: string | null;
  email?: string | null;
  suspended_until?: string | null;
  suspension_reason?: string | null;
  created_at: string;
  /** Lifetime points from the math game */
  game_score_total?: number;
  /** Points available to redeem (50 pts = ₱1) */
  game_score_balance?: number;
  /** PHP wallet from redeeming points; usable at checkout */
  peso_balance?: number;
};

export type AdminProfile = {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  is_master_admin: boolean;
  is_active: boolean;
};

/** Row in `admin_activity_log` (admin audit trail). */
export type AdminActivityLog = {
  id: string;
  created_at: string;
  admin_id: string;
  admin_email: string;
  admin_name: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category: string;
  custom_category?: string | null;
  subcategory?: string | null;
  is_available: boolean;
  /** On-hand units when track_stock is true */
  stock_quantity?: number;
  /** When true, sales decrement stock_quantity */
  track_stock?: boolean;
  display_order?: number;
  created_at: string;
};

export type Order = {
  id: string;
  /** Null for walk-in POS orders */
  user_id: string | null;
  total_amount: number;
  discount_amount: number;
  /** Part of discount_amount paid from customer peso wallet */
  wallet_discount_amount?: number;
  final_amount: number;
  payment_method: 'COD' | 'GCash' | 'Maya' | 'PayPal' | 'Cash';
  /** Where the order was placed */
  order_channel?: 'online' | 'pos';
  /** Admin who rang up a POS sale */
  pos_sold_by_admin_id?: string | null;
  payment_reference: string | null;
  payment_proof_url: string | null;
  status: 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'completed' | 'cancelled';
  delivery_address: string;
  contact_phone: string;
  notes: string | null;
  is_archived?: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentMethodCode = 'GCash' | 'Maya' | 'PayPal';

export type PaymentMethodSetting = {
  method: PaymentMethodCode;
  qr_storage_path: string | null;
  account_number: string | null;
  /** Merchant name registered on the wallet (shown at checkout). */
  account_name: string | null;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  /** Null if the menu product was deleted; line still has `menu_item_name` and prices. */
  menu_item_id: string | null;
  menu_item_name: string;
  quantity: number;
  price: number;
  subtotal: number;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  active: boolean;
  /** `card` = homepage promo card + grid; `marquee` = hero overlay ticker only */
  promo_type?: 'card' | 'marquee';
  /** Storage path in `promo-card-images` bucket; optional hero for card promos */
  card_image_path?: string | null;
  created_at: string;
};

const PROMO_CARD_IMAGE_BUCKET = 'promo-card-images';

export function promoCardImagePublicUrl(
  path: string | null | undefined,
  cacheBust?: string | null
): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(PROMO_CARD_IMAGE_BUCKET).getPublicUrl(path);
  const v = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : '';
  return `${data.publicUrl}${v}`;
}

export { PROMO_CARD_IMAGE_BUCKET };

export type GalleryImage = {
  id: string;
  image_url: string;
  display_order: number;
  created_at: string;
};

export type GamePlay = {
  id: string;
  user_id: string;
  score: number;
  discount_earned: number;
  claimed: boolean;
  played_at: string;
};

export type GameSettings = {
  id: string;
  is_active: boolean;
  falling_pizza_active?: boolean | null;
  updated_at: string;
};

/** Singleton row `id = 1` — official GCash QR object path in Storage bucket `gcash-qr` */
export type SiteSettings = {
  id: number;
  gcash_qr_storage_path: string | null;
  updated_at: string;
};
