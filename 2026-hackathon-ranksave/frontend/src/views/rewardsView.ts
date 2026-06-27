import { api } from '../api';

const PARTNERS = [
  { name: 'Shoprite',   accent: '#E20000', initials: 'SR' },
  { name: 'Pick n Pay', accent: '#C31631', initials: 'PnP' },
  { name: 'Clicks',     accent: '#0047AB', initials: 'CL' },
  { name: 'Woolworths', accent: '#148B42', initials: 'WW' },
  { name: 'Checkers',   accent: '#C8102E', initials: 'CH' },
  { name: 'Dischem',    accent: '#0082C8', initials: 'DC' },
];

const PRIZE_TIERS = [
  { label: 'R20 voucher', value: 20 },
  { label: 'R35 voucher', value: 35 },
  { label: 'R50 voucher', value: 50 },
];

function monthKey(): string {
  const d = new Date();
  return `rs_monthly_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function genCode(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function R(n: number): string {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type GameState = {
  played: boolean;
  pickedIdx: number;
  prizes: Array<{ label: string; value: number }>;
  codes: string[];
};

export async function renderRewardsView(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div class="card"><p class="muted">Loading rewards…</p></div>`;

  let totalSaved = 0;
  let contribCount = 0;
  try {
    const s = await api.savings.get();
    const scale = s.totalSaved.assetScale ?? 2;
    totalSaved = s.totalSaved.value ? Number(s.totalSaved.value) / Math.pow(10, scale) : 0;
    contribCount = s.contributions.filter(c => c.status === 'COMPLETED').length;
  } catch {}

  const now        = new Date();
  const monthIdx   = now.getMonth();
  const partner    = PARTNERS[monthIdx % PARTNERS.length];
  const monthName  = now.toLocaleString('en-ZA', { month: 'long' });
  const year       = now.getFullYear();
  const savedMonths = monthIdx + 1;
  const yearComplete = monthIdx === 11;

  // Monthly game — init once, persist on play
  const mKey = monthKey();
  const storedGame = localStorage.getItem(mKey);
  let game: GameState;
  if (storedGame) {
    game = JSON.parse(storedGame);
  } else {
    const prizes = shuffle([...PRIZE_TIERS]);
    game = { played: false, pickedIdx: -1, prizes, codes: prizes.map(() => genCode(partner.initials)) };
  }

  // Year-end voucher code — stable from first visit
  const yKey       = `rs_year_${year}`;
  const yCodeKey   = `${yKey}_code`;
  const yearClaimed = localStorage.getItem(yKey) === 'claimed';
  if (!localStorage.getItem(yCodeKey)) {
    localStorage.setItem(yCodeKey, genCode('YEAR'));
  }
  const yearCode = localStorage.getItem(yCodeKey)!;

  const draw = () => {
    container.innerHTML = `
      <div class="card send-card">
        <div class="send-header">
          <h2 class="send-title">Rewards</h2>
          <p class="send-subtitle">Earn vouchers for saving smart — powered by our retail partners.</p>
        </div>

        <!-- Monthly Challenge -->
        <div class="rewards-section">
          <div class="rewards-section-head">
            <span class="rewards-section-title">Monthly Challenge</span>
            <span class="badge badge-pending">${monthName} ${year}</span>
          </div>
          <p class="rewards-partner-intro">
            This month in partnership with
            <strong style="color:${partner.accent}">${partner.name}</strong>
          </p>

          <div class="rewards-cards-row" id="cards-row">
            ${game.prizes.map((p, i) => `
              <div class="reward-card${game.played ? ' flipped' : ''}${game.played && game.pickedIdx === i ? ' reward-card-picked' : ''}"
                   data-idx="${i}" role="button" tabindex="${game.played ? '-1' : '0'}">
                <div class="reward-card-inner">
                  <div class="reward-card-front">
                    <div class="reward-card-logo" style="background:${partner.accent}">${partner.initials}</div>
                    <span class="reward-card-tap">Tap to reveal</span>
                  </div>
                  <div class="reward-card-back">
                    <div class="reward-card-logo" style="background:${partner.accent}">${partner.initials}</div>
                    <span class="reward-card-value">${p.label}</span>
                    ${game.played && game.pickedIdx === i
                      ? `<span class="reward-card-code">${game.codes[i]}</span>`
                      : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          ${game.played ? `
            <div class="rewards-voucher-box">
              <span class="rewards-voucher-label">Your ${monthName} voucher</span>
              <strong class="rewards-voucher-prize">${game.prizes[game.pickedIdx].label} — ${partner.name}</strong>
              <code class="rewards-voucher-code">${game.codes[game.pickedIdx]}</code>
              <span class="rewards-voucher-hint">Show this code at any ${partner.name} till</span>
            </div>
          ` : `
            <p class="rewards-pick-hint muted">Pick a card to reveal your voucher — one chance per month.</p>
          `}
        </div>

        <hr class="divider" />

        <!-- Year in Review -->
        <div class="rewards-section">
          <div class="rewards-section-head">
            <span class="rewards-section-title">Year in Review</span>
            <span class="badge ${yearComplete || yearClaimed ? 'badge-success' : 'badge-muted'}">
              ${yearComplete || yearClaimed ? 'Unlocked' : `${savedMonths} / 12 months`}
            </span>
          </div>
          <p class="rewards-section-sub">
            Stay withdrawal-free all year and earn a R500 Shoprite voucher — our biggest reward.
          </p>

          <div class="rewards-year-stats">
            <div class="rewards-year-stat">
              <span class="rewards-year-stat-label">Total saved</span>
              <span class="rewards-year-stat-value">${R(totalSaved)}</span>
            </div>
            <div class="rewards-year-stat">
              <span class="rewards-year-stat-label">Contributions</span>
              <span class="rewards-year-stat-value">${contribCount}</span>
            </div>
            <div class="rewards-year-stat">
              <span class="rewards-year-stat-label">Streak</span>
              <span class="rewards-year-stat-value">${savedMonths} mo</span>
            </div>
          </div>

          <div class="rewards-year-progress">
            <div class="rewards-year-bar">
              <div class="rewards-year-fill" style="width:${Math.min(100, (savedMonths / 12) * 100).toFixed(1)}%"></div>
            </div>
            <div class="rewards-year-labels">
              <span>${savedMonths} months saved</span>
              <span>12 month target</span>
            </div>
          </div>

          ${yearClaimed ? `
            <div class="rewards-voucher-box">
              <span class="rewards-voucher-label">Year-end voucher</span>
              <strong class="rewards-voucher-prize">R500 Shoprite Voucher</strong>
              <code class="rewards-voucher-code">${yearCode}</code>
              <span class="rewards-voucher-hint">Show this code at any Shoprite till</span>
            </div>
          ` : yearComplete ? `
            <div class="rewards-year-prize">
              <span class="rewards-year-prize-label">Your reward is ready</span>
              <strong class="rewards-year-prize-value">R500 Shoprite Voucher</strong>
            </div>
            <button class="btn btn-primary" id="claim-year-btn">Claim Year-End Reward</button>
          ` : `
            <p class="rewards-year-cta muted">
              Keep saving without a lump-sum withdrawal until December to unlock your R500 reward.
            </p>
          `}
        </div>

        <hr class="divider" />

        <!-- Partners -->
        <div class="rewards-section">
          <span class="rewards-section-title">Our Partners</span>
          <div class="rewards-partners">
            ${PARTNERS.map(p => `
              <div class="rewards-partner-chip">
                <div class="rewards-partner-logo" style="background:${p.accent}">${p.initials}</div>
                <span>${p.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    if (!game.played) {
      container.querySelectorAll<HTMLElement>('.reward-card').forEach(card => {
        const pick = () => {
          const idx = parseInt(card.dataset.idx!);
          game.played    = true;
          game.pickedIdx = idx;
          localStorage.setItem(mKey, JSON.stringify(game));
          draw();
        };
        card.addEventListener('click', pick);
        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
        });
      });
    }

    container.querySelector<HTMLButtonElement>('#claim-year-btn')?.addEventListener('click', () => {
      localStorage.setItem(yKey, 'claimed');
      draw();
    });
  };

  draw();
}
