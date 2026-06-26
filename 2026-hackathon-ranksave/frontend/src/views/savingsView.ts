import { api, SavingsSummary } from '../api';
import { escapeHtml } from '../escape';
import { toPointer } from '../pointer';
import { formatMoney } from '../money';

export async function renderSavingsView(container: HTMLElement): Promise<void> {
  container.innerHTML = `<div class="card"><p class="muted">Loading your pension…</p></div>`;

  let data: SavingsSummary;
  try {
    data = await api.savings.get();
  } catch {
    container.innerHTML = `<div class="card"><p class="error-msg">Failed to load your savings.</p></div>`;
    return;
  }

  const { totalSaved, contributions } = data;
  const code  = totalSaved.assetCode  ?? '';
  const scale = totalSaved.assetScale ?? 2;
  const totalDisplay = totalSaved.assetCode
    ? formatMoney(totalSaved.value, code, scale)
    : '—';

  const completed = contributions.filter(c => c.status === 'COMPLETED');

  const statusBadge = (status: string): string => {
    if (status === 'COMPLETED') return `<span class="badge badge-success">Saved</span>`;
    if (status === 'FAILED')    return `<span class="badge badge-muted">Skipped</span>`;
    return `<span class="badge badge-muted">Pending</span>`;
  };

  const rows = contributions.length === 0
    ? `<p class="muted">No stacks yet. Flip on auto-save in your <a href="#/profile">Profile</a>, then make a payment to start your bag. 💸</p>`
    : `
      <ul class="savings-list">
        ${contributions.map(c => `
          <li class="savings-item">
            <div class="savings-item-main">
              <span class="savings-item-amount">${c.status === 'COMPLETED' ? '+ ' : ''}${formatMoney(c.debitAmount, c.assetCode, c.assetScale)}</span>
              <span class="savings-item-date">${new Date(c.createdAt).toLocaleString()}</span>
            </div>
            ${statusBadge(c.status)}
          </li>
        `).join('')}
      </ul>`;

  container.innerHTML = `
    <div class="card send-card">
      <div class="send-header">
        <h2 class="send-title">🔮 Your future fund</h2>
        <p class="send-subtitle">Stacked automatically, a little at a time, every time you spend.</p>
      </div>

      <div class="savings-hero">
        <span class="savings-hero-label">Stacked so far</span>
        <span class="savings-hero-amount">${totalDisplay}</span>
        <span class="savings-hero-sub">${completed.length} contribution${completed.length === 1 ? '' : 's'} · future you approves 🙌</span>
      </div>

      <div class="quote-summary">
        <div class="summary-row">
          <span class="label">Auto-save</span>
          <span class="value">${data.enabled ? `On — ${data.percent}% per payment` : 'Off'}</span>
        </div>
        <div class="summary-row">
          <span class="label">Savings wallet</span>
          <span class="value">${data.walletAddress ? escapeHtml(toPointer(data.walletAddress)) : '<span class="muted">not set</span>'}</span>
        </div>
      </div>

      ${!data.enabled || !data.walletAddress ? `
        <div class="warning-msg">
          Your bag isn't set up yet. <a href="#/profile">Head to Profile</a> to pick a savings wallet and your save %.
        </div>
      ` : ''}

      <hr class="divider" />

      <h3 class="savings-settings-title">Your stacks</h3>
      ${rows}
    </div>
  `;
}
