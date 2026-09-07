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

import { Save } from './save.js';

const PLACEHOLDER_SECONDS = 5;

export const Ads = {
  provider: 'none',        // 'poki' | 'crazygames' | 'none'
  environment: 'none',     // CrazyGames: 'local' | 'crazygames' | 'disabled'
  ready: false,
  inBreak: false,
  adblock: false,
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
        const sdk = window.CrazyGames.SDK;
        // v3 must be awaited before anything else is touched
        await sdk.init();
        this.environment = sdk.environment || 'disabled';
        // On any host that isn't crazygames.com or localhost the SDK reports
        // 'disabled' and every call throws — treat that as no provider so the
        // build still runs correctly on GitHub Pages, itch, etc.
        if (this.environment === 'disabled') {
          this.provider = 'none';
        } else {
          this.provider = 'crazygames';
          this.ready = true;
          // user data syncs across a logged-in player's devices; same API as
          // localStorage, so the save layer can use it as a drop-in backend
          if (sdk.data) Save.setStorageBackend(sdk.data);
          try { this.adblock = await sdk.ad.hasAdblock(); } catch (_) {}
          try { sdk.game.loadingStart(); } catch (_) {}
        }
      }
    } catch (_) {
      this.provider = 'none';
    }
    console.info(`[ads] provider: ${this.provider}`
      + (this.environment !== 'none' ? ` · environment: ${this.environment}` : '')
      + (this.adblock ? ' · adblock detected' : '')
      + (this.ready ? '' : ' · placeholder mode'));
    return this.provider;
  },

  /** Call once the game is playable — portals hold their preloader until this. */
  loadingFinished() {
    try {
      if (this.provider === 'poki') window.PokiSDK.gameLoadingFinished();
      if (this.provider === 'crazygames') window.CrazyGames.SDK.game.loadingStop();
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

  /**
   * CrazyGames uses callbacks rather than promises.
   * The portal requires the game to be paused and muted for the duration of
   * the ad, and resumed on either finish or error.
   */
  _crazyAd(type) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v, err) => {
        if (settled) return;
        settled = true;
        if (err) console.info('[ads] ad not shown:', err.code || err);
        resolve(v);
      };
      try {
        window.CrazyGames.SDK.ad.requestAd(type, {
          adStarted: () => this._pause(),          // belt and braces; already paused
          adFinished: () => done(true),
          adError: (err) => done(false, err),
        });
      } catch (e) { done(false, e); }
      setTimeout(() => done(false, { code: 'timeout' }), 45000);   // never hang the game
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
  async mountBanner(el, size = '300x250') {
    if (!el) return;
    // 300x250 ("Medium") is one of the sizes the portal accepts; the container
    // must already be exactly that size before the banner is requested.
    const [w, h] = size.split('x').map(Number);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.innerHTML = `<div class="ad-banner-inner"><span>Ad</span><small>${w}&times;${h}</small></div>`;
    if (this.provider !== 'crazygames') return;
    // The portal rejects a request against a container that isn't on screen
    // ("notVisible"), so only ask once the bay is actually showing.
    if (!this._visible(el)) return;
    try {
      await window.CrazyGames.SDK.banner.requestBanner({ id: el.id, width: w, height: h });
      this._bannerAt = Date.now();
    } catch (e) {
      console.info('[ads] banner not filled:', (e && e.code) || e);
    }
  },

  _visible(el) {
    if (!el || !el.isConnected) return false;
    if (el.offsetParent === null) return false;              // display:none anywhere up the tree
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },

  /** Portals rate-limit banner refreshes; 30 s is the documented minimum. */
  async refreshBanner(el, size = '300x250') {
    if (this.provider !== 'crazygames') return;
    if (!this._visible(el)) return;
    if (this._bannerAt && Date.now() - this._bannerAt < 31000) return;
    try { window.CrazyGames.SDK.banner.clearBanner(el.id); } catch (_) {}
    return this.mountBanner(el, size);
  },

  clearBanners() {
    try {
      if (this.provider === 'crazygames') window.CrazyGames.SDK.banner.clearAllBanners();
    } catch (_) {}
  },
};
