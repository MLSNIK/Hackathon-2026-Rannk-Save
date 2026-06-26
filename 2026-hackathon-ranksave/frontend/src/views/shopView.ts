import { api, User } from '../api';
import { escapeHtml } from '../escape';

// ─────────────────────────────────────────────────────────────────────────────
// Shop — a little marketplace of online stores. Checking out a product with
// "Interledger" runs the normal RankSave payment flow (quote → consent →
// wallet redirect), so the pension auto-save rides along just like any payment.
// ─────────────────────────────────────────────────────────────────────────────

interface Store {
  id:       string;
  name:     string;
  emoji:    string;
  tagline:  string;
  active:   boolean;
  // The merchant's Interledger wallet that checkout pays into. Swap for a real
  // store wallet in production; this is a known-good test wallet for the demo.
  wallet:   string;
}

interface Product {
  id:    string;
  name:  string;
  emoji: string;
  price: number;   // major units, in the store wallet's currency
  blurb: string;
}

const STORES: Store[] = [
  { id: 'shoplyft',      name: 'ShopLyft',      emoji: '🛍️', tagline: 'Streetwear & tech, delivered fast.', active: true,  wallet: 'https://ilp.interledger-test.dev/coffee' },
  { id: 'pickntakealot', name: 'PickNtakeAlot', emoji: '📦', tagline: 'Everything, all in one cart.',        active: false, wallet: '' },
  { id: 'shoprong',      name: 'Shoprong',      emoji: '🏪', tagline: 'Groceries & daily essentials.',        active: false, wallet: '' },
];

const SHOPLYFT_PRODUCTS: Product[] = [
  { id: 'sneakers',   name: 'Cloud Runner Sneakers', emoji: '👟', price: 89.99,  blurb: 'All-day comfort, street-ready.' },
  { id: 'hoodie',     name: 'Oversized Hoodie',      emoji: '🧥', price: 49.99,  blurb: 'Heavyweight cotton, cosy fit.' },
  { id: 'headphones', name: 'Wireless Headphones',   emoji: '🎧', price: 129.99, blurb: 'Noise-cancelling, 30h battery.' },
  { id: 'backpack',   name: 'Everyday Backpack',     emoji: '🎒', price: 39.99,  blurb: 'Laptop sleeve + water-resistant.' },
  { id: 'shades',     name: 'Retro Sunglasses',      emoji: '🕶️', price: 24.99,  blurb: 'UV400, that main-character energy.' },
  { id: 'watch',      name: 'Smart Watch',           emoji: '⌚', price: 199.99, blurb: 'Track steps, sleep & spending.' },
];

// ─── Brand marks for the checkout (kept inline so there are no asset deps) ──────
const ilpMark = `
  <svg viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.2" aria-hidden="true">
    <circle cx="12" cy="12" r="7" /><ellipse cx="12" cy="12" rx="7" ry="3" />
    <ellipse cx="12" cy="12" rx="3" ry="7" /><circle cx="12" cy="12" r="1.4" fill="#111" stroke="none" />
  </svg>`;
const appleMark = `
  <svg viewBox="0 0 24 24" fill="#111" aria-hidden="true">
    <path d="M17.05 12.04c-.03-2.85 2.33-4.22 2.44-4.28-1.33-1.95-3.4-2.22-4.13-2.25-1.76-.18-3.43 1.04-4.32 1.04-.89 0-2.26-1.02-3.72-.99-1.91.03-3.68 1.11-4.66 2.82-1.99 3.45-.51 8.55 1.43 11.35.95 1.37 2.08 2.91 3.56 2.85 1.43-.06 1.97-.92 3.7-.92 1.72 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.78 1.09-1.6 1.54-3.15 1.56-3.23-.03-.01-2.99-1.15-3.02-4.55zM14.6 4.16c.79-.96 1.32-2.29 1.18-3.61-1.14.05-2.51.76-3.32 1.72-.73.85-1.37 2.2-1.2 3.5 1.27.1 2.56-.65 3.34-1.61z"/>
  </svg>`;

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace landing — the list of stores
// ─────────────────────────────────────────────────────────────────────────────
export function renderShopView(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        <h2 class="send-title">🛒 Shop</h2>
        <p class="send-subtitle">Check out with Interledger — and stack for future you on every order.</p>
      </div>

      <div class="shop-grid">
        ${STORES.map(s => `
          <a class="shop-store ${s.active ? '' : 'shop-store-soon'}" ${s.active ? `href="#/shop/${s.id}"` : ''}>
            <span class="shop-store-emoji">${s.emoji}</span>
            <span class="shop-store-info">
              <span class="shop-store-name">${escapeHtml(s.name)}</span>
              <span class="shop-store-tagline">${escapeHtml(s.tagline)}</span>
            </span>
            ${s.active ? `<span class="shop-store-go">Shop →</span>` : `<span class="badge badge-muted">Coming soon</span>`}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storefront — ShopLyft (the one active store)
// ─────────────────────────────────────────────────────────────────────────────
export async function renderStoreView(container: HTMLElement, user: User, storeId: string): Promise<void> {
  const store = STORES.find(s => s.id === storeId && s.active);
  if (!store) { window.location.hash = '#/shop'; return; }

  // Resolve the store wallet's currency once, so prices + checkout use the real scale.
  let assetCode = 'USD';
  let assetScale = 2;
  try {
    const info = await api.walletInfo(store.wallet);
    assetCode  = info.assetCode;
    assetScale = info.assetScale;
  } catch { /* fall back to USD/2 for display */ }

  const price = (n: number) => `${n.toFixed(2)} ${assetCode}`;

  function renderCatalog(): void {
    container.innerHTML = `
      <div class="card send-card">
        <div class="shop-store-head">
          <a href="#/shop" class="shop-back">← All stores</a>
          <h2 class="send-title">${store!.emoji} ${escapeHtml(store!.name)}</h2>
          <p class="send-subtitle">${escapeHtml(store!.tagline)}</p>
        </div>

        <div class="product-grid">
          ${SHOPLYFT_PRODUCTS.map(p => `
            <div class="product-card">
              <div class="product-emoji">${p.emoji}</div>
              <div class="product-name">${escapeHtml(p.name)}</div>
              <div class="product-blurb">${escapeHtml(p.blurb)}</div>
              <div class="product-foot">
                <span class="product-price">${price(p.price)}</span>
                <button class="btn btn-africa-primary btn-small" data-buy="${p.id}">Buy</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = SHOPLYFT_PRODUCTS.find(p => p.id === btn.dataset.buy);
        if (product) renderCheckout(product);
      });
    });
  }

  function renderCheckout(product: Product): void {
    const noWallet = !user.walletAddress;

    container.innerHTML = `
      <div class="card send-card">
        <div class="shop-store-head">
          <a class="shop-back" id="checkout-back">← Back to ${escapeHtml(store!.name)}</a>
          <h2 class="send-title">Checkout</h2>
        </div>

        <div class="checkout-item">
          <div class="checkout-emoji">${product.emoji}</div>
          <div class="checkout-item-info">
            <span class="checkout-item-name">${escapeHtml(product.name)}</span>
            <span class="checkout-item-store">${escapeHtml(store!.name)}</span>
          </div>
          <span class="checkout-item-price">${price(product.price)}</span>
        </div>

        <hr class="divider" />

        <div class="checkout-label">Select payment method</div>
        <div class="pay-methods">
          <button class="pay-method" id="pay-ilp">
            <span class="pay-method-logo">${ilpMark}</span>
            <span class="pay-method-name">Interledger</span>
          </button>
          <button class="pay-method pay-method-disabled" disabled>
            <span class="pay-method-logo">${appleMark}</span>
            <span class="pay-method-name">Pay</span>
          </button>
          <button class="pay-method pay-method-disabled" disabled>
            <span class="pay-method-logo"><span class="gpay-g">G</span></span>
            <span class="pay-method-name">Pay</span>
          </button>
        </div>

        ${noWallet ? `
          <div class="warning-msg">
            Add your wallet address in <a href="#/profile">Profile</a> before checking out with Interledger.
          </div>
        ` : `
          <p class="muted checkout-note">Paying with Interledger runs your RankSave checkout — your order is paid first, and your pension top-up rides along in the same approval.</p>
        `}

        <div id="checkout-error" class="error-msg" hidden></div>
      </div>
    `;

    container.querySelector('#checkout-back')!.addEventListener('click', renderCatalog);

    const ilpBtn = container.querySelector<HTMLButtonElement>('#pay-ilp')!;
    const errDiv = container.querySelector<HTMLDivElement>('#checkout-error')!;

    ilpBtn.addEventListener('click', async () => {
      if (noWallet) {
        errDiv.textContent = 'Set your wallet address in Profile first.';
        errDiv.hidden = false;
        return;
      }

      ilpBtn.disabled    = true;
      ilpBtn.classList.add('pay-method-loading');
      ilpBtn.querySelector('.pay-method-name')!.textContent = 'Connecting…';
      errDiv.hidden = true;

      try {
        const smallestUnit = Math.round(product.price * 10 ** assetScale).toString();
        // Same RankSave flow as a normal send: quote (sets up the savings top-up),
        // request the single combined consent, then redirect to the wallet.
        const quote = await api.quote({
          senderWalletAddress:   user.walletAddress!,
          receiverWalletAddress: store!.wallet,
          amount:                smallestUnit,
          paymentType:           'FIXED_RECEIVE',
        });
        const { interactUrl } = await api.consent(quote.transactionId);
        window.location.href = interactUrl;
      } catch (err: unknown) {
        errDiv.textContent = err instanceof Error ? err.message : String(err);
        errDiv.hidden = false;
        ilpBtn.disabled = false;
        ilpBtn.classList.remove('pay-method-loading');
        ilpBtn.querySelector('.pay-method-name')!.textContent = 'Interledger';
      }
    });
  }

  renderCatalog();
}
