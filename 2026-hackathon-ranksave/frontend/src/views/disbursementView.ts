import { api, SavingsSummary, User } from '../api';

const SAVINGS_POT_SHARE    = 1 / 3;
const RETIREMENT_POT_SHARE = 2 / 3;
const MIN_WITHDRAWAL       = 2_000;      // R2,000 statutory minimum
const DRAWDOWN_RATE        = 0.07 / 12;  // 7% p.a. conservative drawdown in retirement
const DRAWDOWN_MONTHS      = 25 * 12;    // 25-year annuity
const COMFORT_INCOME       = 6_000;      // R6,000/month informal-worker comfort target

function R(n: number): string {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function annuity(pv: number): number {
  if (pv <= 0) return 0;
  const r = DRAWDOWN_RATE;
  const n = DRAWDOWN_MONTHS;
  return pv * r / (1 - Math.pow(1 + r, -n));
}

export async function renderDisbursementView(container: HTMLElement, user: User): Promise<void> {
  container.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;

  let savings: SavingsSummary | null = null;
  try { savings = await api.savings.get(); } catch {}

  const scale      = savings?.totalSaved.assetScale ?? 2;
  const divisor    = Math.pow(10, scale);
  const totalSaved = savings?.totalSaved.value
    ? Number(savings.totalSaved.value) / divisor
    : 0;

  const savingsPot    = totalSaved * SAVINGS_POT_SHARE;
  const retirementPot = totalSaved * RETIREMENT_POT_SHARE;
  const monthlyIncome = annuity(retirementPot);
  const comfortPct    = Math.min(100, (monthlyIncome / COMFORT_INCOME) * 100);
  const comfortable   = monthlyIncome >= COMFORT_INCOME;

  const noSavings  = !user.savingsWalletAddress;
  const noSpending = !user.walletAddress;
  const canWithdraw = savingsPot >= MIN_WITHDRAWAL;

  // Lump-sum section body — shown inside the card
  let lumpSumBody: string;
  if (noSavings || noSpending) {
    lumpSumBody = `
      <div class="warning-msg">
        ${noSavings ? 'Add your savings wallet in <a href="#/profile">Profile</a>.' : 'Add your spending wallet in <a href="#/profile">Profile</a>.'}
      </div>`;
  } else if (canWithdraw) {
    lumpSumBody = `
      <div class="field">
        <label for="disb-amount">Amount to withdraw</label>
        <div class="amount-wrap">
          <input id="disb-amount" type="number" class="input"
            min="${MIN_WITHDRAWAL}" max="${Math.floor(savingsPot)}"
            step="100" value="${Math.min(Math.floor(savingsPot), MIN_WITHDRAWAL)}" />
          <span class="amount-currency">ZAR</span>
        </div>
        <span class="field-hint">Min ${R(MIN_WITHDRAWAL)} · Available ${R(savingsPot)}</span>
      </div>
      <div class="disb-tax-note">
        Withdrawals are taxed as income at your marginal rate. Consult a financial advisor.
      </div>
      <button class="btn btn-primary" id="disb-btn">Request Lump Sum Withdrawal</button>
      <div id="disb-error" class="error-msg" hidden></div>`;
  } else {
    lumpSumBody = `
      <div class="disb-locked-msg">
        You need at least ${R(MIN_WITHDRAWAL)} in your Savings Pot to withdraw.
        Keep saving — <strong>${R(MIN_WITHDRAWAL - savingsPot)}</strong> to go.
      </div>`;
  }

  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        <h2 class="send-title">Two-Pot Disbursement</h2>
        <p class="send-subtitle">Access your pension savings — South Africa's Two-Pot System.</p>
      </div>

      <!-- Pot overview -->
      <div class="disb-pots">
        <div class="disb-pot">
          <span class="disb-pot-label">Savings Pot (⅓)</span>
          <span class="disb-pot-amount disb-pot-access">${R(savingsPot)}</span>
          <span class="disb-pot-sub">Accessible now</span>
        </div>
        <div class="disb-pot-divider"></div>
        <div class="disb-pot">
          <span class="disb-pot-label">Retirement Pot (⅔)</span>
          <span class="disb-pot-amount disb-pot-retire">${R(retirementPot)}</span>
          <span class="disb-pot-sub">Age 55+</span>
        </div>
      </div>

      <!-- ── Lump Sum ── -->
      <div class="disb-section">
        <div class="disb-section-head">
          <span class="disb-section-title">Lump Sum</span>
          <span class="badge ${canWithdraw ? 'badge-success' : 'badge-muted'}">
            ${canWithdraw ? 'Available' : `Min ${R(MIN_WITHDRAWAL)}`}
          </span>
        </div>
        <p class="disb-section-sub">Once per tax year from your Savings Pot.</p>
        ${lumpSumBody}
      </div>

      <div class="divider"></div>

      <!-- ── Monthly Payments ── -->
      <div class="disb-section">
        <div class="disb-section-head">
          <span class="disb-section-title">Monthly Payments</span>
          <span class="badge badge-muted">Age 55+</span>
        </div>
        <p class="disb-section-sub">
          Convert your Retirement Pot into a monthly annuity for 25 years at retirement.
        </p>

        <div class="disb-monthly-grid">
          <div class="disb-monthly-stat">
            <span class="disb-monthly-label">Retirement Pot</span>
            <span class="disb-monthly-value">${R(retirementPot)}</span>
          </div>
          <div class="disb-monthly-stat">
            <span class="disb-monthly-label">Est. Monthly Income</span>
            <span class="disb-monthly-value ${comfortable ? 'disb-value-ok' : ''}">${R(monthlyIncome)}/mo</span>
          </div>
        </div>

        <div class="disb-progress-wrap">
          <div class="disb-progress-bar">
            <div class="disb-progress-fill" style="width:${comfortPct.toFixed(1)}%"></div>
          </div>
          <div class="disb-progress-labels">
            <span>${R(monthlyIncome)}/mo</span>
            <span>Comfort: ${R(COMFORT_INCOME)}/mo</span>
          </div>
        </div>

        ${comfortable
          ? `<p class="disb-comfort-msg disb-ok">Your pot can provide ${R(COMFORT_INCOME)}/month for 25 years — comfortable retirement.</p>`
          : `<p class="disb-comfort-msg disb-gap">
               ${R(COMFORT_INCOME - monthlyIncome)}/month short of comfort target.
               Keep growing your pot.
             </p>`
        }

        <button class="btn btn-secondary disb-retire-btn" disabled>
          Set Up Monthly Payments
          <span class="disb-age-badge">Available at 55</span>
        </button>
      </div>
    </div>
  `;

  // ── Wire lump-sum withdrawal ──────────────────────────────────────────────
  const withdrawBtn = container.querySelector<HTMLButtonElement>('#disb-btn');
  if (!withdrawBtn) return;

  withdrawBtn.addEventListener('click', async () => {
    const amountInput = container.querySelector<HTMLInputElement>('#disb-amount')!;
    const errDiv      = container.querySelector<HTMLDivElement>('#disb-error')!;
    const amount      = parseFloat(amountInput.value) || 0;

    errDiv.hidden = true;

    if (amount < MIN_WITHDRAWAL) {
      errDiv.textContent = `Minimum withdrawal is ${R(MIN_WITHDRAWAL)}.`;
      errDiv.hidden = false;
      return;
    }
    if (amount > savingsPot) {
      errDiv.textContent = `You can withdraw at most ${R(savingsPot)} from your Savings Pot.`;
      errDiv.hidden = false;
      return;
    }

    withdrawBtn.disabled  = true;
    withdrawBtn.textContent = 'Requesting…';

    try {
      const smallestUnit = Math.round(amount * divisor).toString();
      // Savings wallet → spending wallet (FIXED_SEND: send exactly the stated amount)
      const quote = await api.quote({
        senderWalletAddress:   user.savingsWalletAddress!,
        receiverWalletAddress: user.walletAddress!,
        amount:                smallestUnit,
        paymentType:           'FIXED_SEND',
      });
      const { interactUrl } = await api.consent(quote.transactionId);
      window.location.href  = interactUrl;
    } catch (err: unknown) {
      errDiv.textContent = err instanceof Error ? err.message : String(err);
      errDiv.hidden      = false;
      withdrawBtn.disabled    = false;
      withdrawBtn.textContent = 'Request Lump Sum Withdrawal';
    }
  });
}
