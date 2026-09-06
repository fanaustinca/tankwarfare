// ───────────────────────────────────────────────────────────────
//  Portal advertising layer.
//
//  The game never talks to a portal SDK directly. It calls this
//  module, which uses whichever SDK is actually present on the
//  page and otherwise falls back to a visible placeholder. That
//  means the build runs identically on itch, GitHub Pages, Poki
//  and CrazyGames with no code changes.
//
//  To go live on a portal, add their loader script to index.html —
//  the portal supplies it, and the detection below picks it up:
//    Poki        <script src="//game-cdn.poki.com/scripts/v2/poki-sdk.js">
//    CrazyGames  <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">
//
//  Every call is wrapped: a portal SDK that is missing, blocked by
//  an ad blocker, or throwing must never stop the game.
// ───────────────────────────────────────────────────────────────

const PLACEHOLDER_SECONDS = 5;

export const Ads = {
  provider: 'none',        // 'poki' | 'crazygames' | 'none'
  ready: false,
  inBreak: false,
  _hooks: { onPause: null, onResume: null },

  /** @param hooks { onPause, onResume } — used to freeze the game during a break. */
  async init(hooks = {}) {
    this._hooks = { ...this._hooks, ...hooks };
    this._buildOverlay();

    try {
      if (window.PokiSDK && typeof window.PokiSDK.init === 'function') {
        this.provider = 'poki';
        await window.PokiSDK.init().catch(() => {});
        // debug mode is only for local development; portals reject it in review
        if (location.hostname === 'localhost' && window.PokiSDK.setDebug) {
          try { window.PokiSDK.setDebug(true); } catch (_) {}
        }
        this.ready = true;
      } else if (window.CrazyGames && window.CrazyGames.SDK) {
        this.provider = 'crazygames';
        const sdk = window.CrazyGames.SDK;
        if (typeof sdk.init === 'function') await sdk.init().catch(() => {});
        this.ready = true;
      }
    } catch (_) {
      this.provider = 'none';
    }
    console.info(`[ads] provider: ${this.provider}${this.ready ? '' : ' (placeholder mode)'}`);
    return this.provider;
  },

  /** Call once the game is playable — portals hold their preloader until this. */
  loadingFinished() {
    try {
      if (this.provider === 'poki') window.PokiSDK.gameLoadingFinished();
      if (this.provider === 'crazygames') window.CrazyGames.SDK.game.loadingStop?.();
    } catch (_) {}
  },

  /** Bracket actual play so portals know when not to interrupt. */
  gameplayStart() {
    try {
      if (this.provider === 'poki') window.PokiSDK.gameplayStart();
      if (this.provider === 'crazygames') window.CrazyGames.SDK.game.gameplayStart();
    } catch (_) {}
  },

  gameplayStop() {
    try {
      if (this.provider === 'poki') window.PokiSDK.gameplayStop();
      if (this.provider === 'crazygames') window.CrazyGames.SDK.game.gameplayStop();
    } catch (_) {}
  },

  /** A moment worth celebrating — portals use it to time their own prompts. */
  happytime() {
    try {
      if (this.provider === 'poki') window.PokiSDK.happyTime(1);
      if (this.provider === 'crazygames') window.CrazyGames.SDK.game.happytime();
    } catch (_) {}
  },

  /**
   * Interstitial between waves. Always resolves — never leaves the game paused.
   * @returns {Promise<boolean>} whether a real ad was shown
   */
  async commercialBreak(label = 'Commercial break') {
    if (this.inBreak) return false;
    this.inBreak = true;
    this._pause();
    let shown = false;
    try {
      if (this.provider === 'poki') {
        await window.PokiSDK.commercialBreak();
        shown = true;
      } else if (this.provider === 'crazygames') {
        shown = await this._crazyAd('midgame');
      } else {
        await this._placeholder(label, false);
      }
    } catch (_) { /* blocked or unavailable — carry on */ }
    this._resume();
    this.inBreak = false;
    return shown;
  },

  /**
   * Rewarded ad. Resolves true only if the player actually earned the reward.
   */
  async rewardedBreak(label = 'Rewarded ad') {
    if (this.inBreak) return false;
    this.inBreak = true;
    this._pause();
    let earned = false;
    try {
      if (this.provider === 'poki') {
        earned = await window.PokiSDK.rewardedBreak();
      } else if (this.provider === 'crazygames') {
        earned = await this._crazyAd('rewarded');
      } else {
        earned = await this._placeholder(label, true);
      }
    } catch (_) { earned = false; }
    this._resume();
    this.inBreak = false;
    return earned;
  },

  /** CrazyGames uses callbacks rather than promises. */
  _crazyAd(type) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        window.CrazyGames.SDK.ad.requestAd(type, {
          adFinished: () => done(true),
          adError: () => done(false),
          adStarted: () => {},
        });
      } catch (_) { done(false); }
      setTimeout(() => done(false), 45000);      // never hang the game
    });
  },

  // ─────────────── placeholder ───────────────
  _buildOverlay() {
    if (this._ov) return;
    const ov = document.createElement('div');
    ov.id = 'ad-overlay';
    ov.className = 'hidden';
    ov.innerHTML = `
      <div class="ad-box">
        <div class="ad-tag">Advertisement</div>
        <div class="ad-fill">
          <div class="ad-slot-label" id="ad-label">Commercial break</div>
          <div class="ad-note">Placeholder &mdash; a Poki or CrazyGames ad renders here in the portal build</div>
        </div>
        <div class="ad-foot">
          <span id="ad-count"></span>
          <button class="btn" id="ad-skip">Skip</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    this._ov = ov;
  },

  _placeholder(label, rewarded) {
    return new Promise((resolve) => {
      const ov = this._ov;
      const count = ov.querySelector('#ad-count');
      const skip = ov.querySelector('#ad-skip');
      ov.querySelector('#ad-label').textContent = label;
      ov.classList.remove('hidden');

      let left = PLACEHOLDER_SECONDS;
      const tick = () => {
        count.textContent = left > 0 ? `${left}s` : 'complete';
        skip.disabled = rewarded && left > 0;
        skip.textContent = rewarded ? (left > 0 ? 'Claim reward' : 'Claim reward') : 'Skip';
        if (left <= 0) { clearInterval(iv); if (!rewarded) finish(true); }
        left--;
      };
      const finish = (v) => {
        clearInterval(iv);
        ov.classList.add('hidden');
        skip.onclick = null;
        resolve(v);
      };
      skip.onclick = () => finish(!rewarded || left < 0);
      tick();
      const iv = setInterval(tick, 1000);
    });
  },

  _pause() { try { this._hooks.onPause && this._hooks.onPause(); } catch (_) {} },
  _resume() { try { this._hooks.onResume && this._hooks.onResume(); } catch (_) {} },

  /**
   * Static banner slots. Portals that support display banners replace the
   * element's contents; otherwise the placeholder box stays visible.
   */
  mountBanner(el, size = '300x250') {
    if (!el) return;
    const [w, h] = size.split('x');
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.innerHTML = `<div class="ad-banner-inner"><span>Ad</span><small>${size}</small></div>`;
    try {
      if (this.provider === 'crazygames' && window.CrazyGames.SDK.banner) {
        window.CrazyGames.SDK.banner.requestBanner({
          id: el.id, width: +w, height: +h,
        });
      }
    } catch (_) {}
  },
};
