import { api, QuoteResponse } from '../api';
import { formatMoney } from '../money';

export function renderConsentView(
  container: HTMLElement,
  quoteRes: QuoteResponse,
  onBack: () => void
): void {
  const { debitAmount, receiveAmount, expiresAt } = quoteRes.quote;
  const fixedSend = quoteRes.paymentType === 'FIXED_SEND';
  const savings   = quoteRes.savings ?? null;

  // When auto-save is on, the user is debited the bill PLUS the savings top-up.
  const totalDebitValue = savings
    ? (BigInt(debitAmount.value) + BigInt(savings.amount.value)).toString()
    : debitAmount.value;

  function summaryRow(label: string, amount: { value: string; assetCode: string; assetScale: number }, isFixed: boolean): string {
    return `
      <div class="summary-row${isFixed ? ' is-fixed' : ''}">
        <span class="label">${label}</span>
        <span class="value-group">
          <span class="value">${formatMoney(amount.value, amount.assetCode, amount.assetScale)}</span>
          <span class="${isFixed ? 'badge-fixed' : 'badge-calc'}">${isFixed ? 'fixed' : 'calc'}</span>
        </span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        <h2 class="send-title">Confirm &amp; Authorise</h2>
        <p class="send-subtitle">Review the amounts below before authorising.</p>
      </div>

      <div class="quote-summary">
        ${summaryRow('You pay', debitAmount, fixedSend)}
        ${summaryRow('Recipient receives', receiveAmount, !fixedSend)}
        ${savings ? `
          <div class="summary-row summary-row-savings">
            <span class="label">🏦 Auto-save to pension</span>
            <span class="value-group">
              <span class="value">+ ${formatMoney(savings.amount.value, savings.amount.assetCode, savings.amount.assetScale)}</span>
            </span>
          </div>
          <hr class="divider" style="margin:0" />
          <div class="summary-row summary-row-total">
            <span class="label"><strong>Total debited</strong></span>
            <span class="value-group">
              <span class="value"><strong>${formatMoney(totalDebitValue, debitAmount.assetCode, debitAmount.assetScale)}</strong></span>
            </span>
          </div>
          <p class="muted">One approval covers both — and your payment is always made first.</p>
        ` : ''}
        ${expiresAt ? `
          <hr class="divider" style="margin:0" />
          <p class="muted">Quote expires at <strong>${new Date(expiresAt).toLocaleTimeString()}</strong></p>
        ` : ''}
      </div>

      <hr class="divider" />

      <p class="muted">
        Clicking <strong>Authorise</strong> will redirect you to your wallet's consent page.
        Return here automatically after approving.
      </p>

      <div id="consent-error" class="error-msg" hidden></div>

      <div class="btn-row">
        <button class="btn btn-secondary"      id="back-btn">← Back</button>
        <button class="btn btn-africa-primary" id="consent-btn">Authorise Payment</button>
      </div>
    </div>
  `;

  container.querySelector('#back-btn')!.addEventListener('click', onBack);

  const btn    = container.querySelector<HTMLButtonElement>('#consent-btn')!;
  const errDiv = container.querySelector<HTMLDivElement>('#consent-error')!;

  btn.addEventListener('click', async () => {
    btn.disabled    = true;
    btn.textContent = 'Redirecting…';
    errDiv.hidden   = true;

    try {
      const { interactUrl } = await api.consent(quoteRes.transactionId);
      window.location.href = interactUrl;
    } catch (err: unknown) {
      const msg      = err instanceof Error ? err.message : String(err);
      errDiv.textContent = msg;
      errDiv.hidden  = false;
      btn.disabled   = false;
      btn.textContent = 'Authorise Payment';
    }
  });
}
