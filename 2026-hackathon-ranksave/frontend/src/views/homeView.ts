import { isLoggedIn } from '../auth';

// Inline SVG icons (Feather-style, stroke follows currentColor).
// Add or swap icons here rather than reaching for emoji — they render
// consistently across platforms and pick up the theme colour.
const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const icons = {
  bolt:   `<svg ${SVG_ATTRS}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  fx:     `<svg ${SVG_ATTRS}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  globe:  `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  unlock: `<svg ${SVG_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
};

export function renderHomeView(container: HTMLElement): void {
  if (isLoggedIn()) {
    renderDashboardHome(container);
  } else {
    renderPublicHome(container);
  }
}

function renderDashboardHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="home-logged-in">
      <div class="home-hero-band">
        <h1 class="home-hero-title">Spend today.</h1>
        <h1 class="home-hero-title home-hero-title-warm">Secure tomorrow.</h1>
        <p class="home-hero-body">
          Every payment quietly stacks a little into your retirement.<br />
          No budgeting, no effort — future you is already winning. 💸
        </p>
        <div class="home-hero-cta-row">
          <a href="#/remit"   class="btn btn-africa-primary">Send money →</a>
          <a href="#/savings" class="btn btn-secondary">My bag</a>
        </div>
      </div>

      <div class="home-pillars">
        <div class="home-pillar">
          <span class="home-pillar-icon">${icons.bolt}</span>
          <div>
            <div class="home-pillar-label">Save on autopilot</div>
            <div class="home-pillar-text">A slice of every payment slides straight to future-you. Set it once, forget it.</div>
          </div>
        </div>
        <div class="home-pillar">
          <span class="home-pillar-icon">${icons.fx}</span>
          <div>
            <div class="home-pillar-label">Your payment comes first</div>
            <div class="home-pillar-text">Running low? We pay the bill and skip the save. Zero stress, never overdrawn.</div>
          </div>
        </div>
        <div class="home-pillar">
          <span class="home-pillar-icon">${icons.unlock}</span>
          <div>
            <div class="home-pillar-label">Watch your bag grow</div>
            <div class="home-pillar-text">Track your retirement stack climb with every single tap.</div>
          </div>
        </div>
      </div>

      <div class="home-proverb-band">
        <p class="home-proverb">Little by little, the bag grows. Future you says thanks. 🙌</p>
      </div>
    </div>
  `;
}

function renderPublicHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="card hero">
      <div class="hero-africa-tag">${icons.globe} Retirement, reinvented for Gen Z</div>
      <h1>Spend now, secure later</h1>
      <p class="hero-sub">
        RankSave tucks a little into your future every time you pay.
        Effortless retirement saving, built for how you actually spend.
      </p>
      <div class="hero-actions">
        <a href="#/signup" class="btn btn-primary">Get started</a>
        <a href="#/login"  class="btn btn-secondary">Log in</a>
      </div>
      <div class="hero-features">
        <div class="feature">
          <span class="feature-icon">${icons.bolt}</span>
          <span>Auto-save as you spend</span>
        </div>
        <div class="feature">
          <span class="feature-icon">${icons.fx}</span>
          <span>Payment always first</span>
        </div>
        <div class="feature">
          <span class="feature-icon">${icons.globe}</span>
          <span>Watch it grow</span>
        </div>
      </div>
    </div>
  `;
}
