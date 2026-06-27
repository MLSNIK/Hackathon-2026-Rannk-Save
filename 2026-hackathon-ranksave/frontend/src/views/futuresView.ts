import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { api, HistoryEntry, SavingsSummary, User } from '../api';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const ANNUAL_RATE  = 0.11;
const MONTHLY_RATE = ANNUAL_RATE / 12;
const YEARS        = 30;

// Conservative comfort target for informal workers:
//   R6,000/month for 25 years, assuming 7% p.a. during drawdown
const COMFORT_INCOME     = 6_000;
const DRAWDOWN_RATE      = 0.07 / 12;
const DRAWDOWN_MONTHS    = 25 * 12;
const COMFORT_NEST_EGG   = Math.round(
  COMFORT_INCOME * (1 - Math.pow(1 + DRAWDOWN_RATE, -DRAWDOWN_MONTHS)) / DRAWDOWN_RATE
);

function compound(pv: number, pmt: number, months: number): number {
  const r = MONTHLY_RATE;
  return pv * Math.pow(1 + r, months) + pmt * (Math.pow(1 + r, months) - 1) / r;
}

function principal(pv: number, pmt: number, months: number): number {
  return pv + pmt * months;
}

function zar(n: number): string {
  return `${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZAR`;
}

function avgMonthlySpend(history: HistoryEntry[]): number {
  const spent = history.filter(
    tx => tx.direction === 'sent' && tx.status === 'COMPLETED' && tx.kind !== 'SAVINGS'
  );
  if (spent.length === 0) return 500;

  const total = spent.reduce((sum, tx) => {
    const scale = tx.assetScale ?? 2;
    return sum + Number(tx.debitAmount ?? 0) / Math.pow(10, scale);
  }, 0);

  const oldest  = spent.reduce((min, tx) =>
    new Date(tx.createdAt) < new Date(min.createdAt) ? tx : min
  );
  const msActive = Date.now() - new Date(oldest.createdAt).getTime();
  const months   = Math.max(1, msActive / (1000 * 60 * 60 * 24 * 30.44));
  return Math.max(1, Math.round(total / months));
}

export async function renderFuturesView(container: HTMLElement, _user: User): Promise<void> {
  container.innerHTML = `<div class="card"><p class="muted">Loading projection…</p></div>`;

  let savings: SavingsSummary | null = null;
  let history: HistoryEntry[]        = [];
  try { [savings, history] = await Promise.all([api.savings.get(), api.history()]); } catch {}

  const scale   = savings?.totalSaved.assetScale ?? 2;
  const current = savings?.totalSaved.value
    ? Number(savings.totalSaved.value) / Math.pow(10, scale)
    : 0;

  const defaultPmt = avgMonthlySpend(history);

  container.innerHTML = `
    <div class="futures-page">
      <div class="card send-card">

        <div class="send-header">
          <h2 class="send-title">Future You</h2>
          <p class="send-subtitle">Your auto-save growth over ${YEARS} years — invested with Allan Gray.</p>
        </div>

        <div class="ag-card">
          <div class="ag-logo">AG</div>
          <div class="ag-info">
            <span class="ag-name">Allan Gray</span>
            <span class="ag-tagline">Your savings wallet is invested for long-term growth</span>
          </div>
        </div>

        <div class="futures-inputs">
          <div class="field">
            <label for="fut-monthly">Monthly contribution (R)</label>
            <input id="fut-monthly" type="number" class="input" min="0" step="100" value="${defaultPmt}" />
            <span class="field-hint">Based on your average monthly spending</span>
          </div>
        </div>

        <div class="futures-chart-wrap">
          <canvas id="fut-chart"></canvas>
        </div>

        <div class="futures-legend">
          <span class="futures-legend-item futures-legend-portfolio">Allan Gray portfolio</span>
          <span class="futures-legend-item futures-legend-principal">What you put in</span>
          <span class="futures-legend-item futures-legend-growth">Investment growth</span>
          <span class="futures-legend-item futures-legend-threshold">Comfort target</span>
        </div>

        <div class="futures-year-total">
          Year ${YEARS} : <strong id="fut-total">—</strong>
        </div>

        <div class="futures-threshold-note">
          Comfort target: R${COMFORT_INCOME.toLocaleString('en-ZA')}/month for 25 years
          = <strong>R${COMFORT_NEST_EGG.toLocaleString('en-ZA')}</strong> nest egg
        </div>

        <p id="fut-comfort-msg" class="futures-comfort-msg"></p>

        <p class="futures-disclaimer">
          Projected at 11% p.a. — Allan Gray Equity Fund historical average. Comfort target assumes
          7% p.a. during drawdown over 25 years. Past performance does not guarantee future results.
        </p>
      </div>
    </div>
  `;

  const monthlyEl  = container.querySelector<HTMLInputElement>('#fut-monthly')!;
  const totalEl    = container.querySelector<HTMLElement>('#fut-total')!;
  const msgEl      = container.querySelector<HTMLElement>('#fut-comfort-msg')!;
  const canvas     = container.querySelector<HTMLCanvasElement>('#fut-chart')!;

  const labels: string[] = [];
  for (let y = 0; y <= YEARS; y++) {
    labels.push(y === 0 ? 'Now' : `+${y}y`);
  }

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Allan Gray portfolio',
          data: [],
          borderColor: '#7C5CFF',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#7C5CFF',
          tension: 0.4,
          fill: { target: 1, above: 'rgba(52, 224, 161, 0.22)' },
          order: 1,
        },
        {
          label: 'What you put in',
          data: [],
          borderColor: '#FF5CA8',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0,
          fill: false,
          order: 2,
        },
        {
          label: 'Comfort target',
          data: new Array(YEARS + 1).fill(COMFORT_NEST_EGG),
          borderColor: 'rgba(16, 185, 129, 0.85)',
          borderWidth: 1.5,
          borderDash: [8, 5],
          pointRadius: 0,
          tension: 0,
          fill: false,
          order: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#16142E',
          borderColor: '#2C2856',
          borderWidth: 1,
          titleColor: '#F5F3FF',
          bodyColor: '#A9A3CF',
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 2) return `Comfort target: ${zar(COMFORT_NEST_EGG)}`;
              return `${ctx.dataset.label}: ${zar(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          border: { display: false },
          ticks: {
            color: '#A9A3CF',
            maxTicksLimit: 4,
            font: { size: 11 },
            callback: (_val, idx) => {
              if (idx === 0 || idx % 10 === 0) return labels[idx];
              return null;
            },
          },
          grid: { display: false },
        },
        y: {
          border: { display: false },
          ticks: {
            color: '#A9A3CF',
            font: { size: 11 },
            maxTicksLimit: 6,
            callback: (v) => {
              const n = Number(v);
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
              if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
              return String(n);
            },
          },
          grid: { color: 'rgba(255,255,255,0.07)', lineWidth: 1 },
        },
      },
    },
  });

  function update(): void {
    const pmt = Math.max(0, parseFloat(monthlyEl.value) || 0);

    const portfolioData: number[] = [];
    const principalData: number[] = [];

    for (let y = 0; y <= YEARS; y++) {
      portfolioData.push(Math.round(compound(current, pmt, y * 12)));
      principalData.push(Math.round(principal(current, pmt, y * 12)));
    }

    const endDot = new Array(portfolioData.length - 1).fill(0).concat([6]);
    chart.data.datasets[0].data = portfolioData;
    (chart.data.datasets[0] as any).pointRadius      = endDot;
    (chart.data.datasets[0] as any).pointHoverRadius = endDot.map((r: number) => r ? r + 2 : 5);
    chart.data.datasets[1].data = principalData;
    chart.update();

    const finalPortfolio = portfolioData[portfolioData.length - 1];
    totalEl.textContent  = zar(finalPortfolio);

    if (finalPortfolio >= COMFORT_NEST_EGG) {
      const yearsToTarget = portfolioData.findIndex(v => v >= COMFORT_NEST_EGG);
      const yr = yearsToTarget >= 0 ? yearsToTarget : YEARS;
      msgEl.textContent = `You reach the comfort target at year ${yr}. From there you can withdraw R${COMFORT_INCOME.toLocaleString('en-ZA')}/month for 25 years — enough to live comfortably.`;
      msgEl.className   = 'futures-comfort-msg futures-ok';
    } else {
      const shortfall = Math.round(COMFORT_NEST_EGG - finalPortfolio);
      const extra     = Math.round(shortfall / ((YEARS * 12) * (Math.pow(1 + MONTHLY_RATE, YEARS * 12) - 1) / MONTHLY_RATE));
      msgEl.textContent = `R${shortfall.toLocaleString('en-ZA')} short of the comfort target. Contributing an extra ~R${extra}/month would close the gap.`;
      msgEl.className   = 'futures-comfort-msg futures-gap';
    }
  }

  monthlyEl.addEventListener('input', update);
  update();
}
