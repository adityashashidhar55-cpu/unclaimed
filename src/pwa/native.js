/**
 * UNCLAIMED — native bridge.
 *
 * The same app runs in three places: a browser tab, an installed PWA, and a
 * signed native binary from the App Store or Play Store. This module is the
 * only file that knows which, and every capability degrades rather than
 * throwing — so the web build never breaks when a native plugin is absent,
 * and the native build gets real OS integration rather than a web fallback.
 *
 * WHY THIS EXISTS AT ALL, RATHER THAN SHIPPING THE PWA IN A WEBVIEW
 *
 * App Store guideline 4.2 rejects apps whose only function is to display a
 * website. A wrapper around a page would be rejected, and would deserve to be.
 * What makes this a real app is that the work happens on the device:
 *
 *   - the eligibility matcher runs locally against a bundled dataset, so the
 *     free check works in airplane mode;
 *   - deadlines become OS-level notifications scheduled months ahead, which a
 *     web page cannot do on iOS at all;
 *   - the document vault is unlocked with Face ID or fingerprint;
 *   - exports go through the native share sheet and the real filesystem.
 *
 * Those are four things a browser tab cannot do, and they are the reason the
 * app is worth installing.
 */

const g = typeof globalThis !== 'undefined' ? globalThis : window;

/** True only inside a Capacitor shell — not in a browser, not in a PWA. */
export const isNative = !!(g.Capacitor && g.Capacitor.isNativePlatform && g.Capacitor.isNativePlatform());

export const platform = () => (g.Capacitor?.getPlatform ? g.Capacitor.getPlatform() : 'web');

/** Installed as a PWA (standalone) rather than an ordinary tab. */
export const isInstalledPwa = () =>
  !isNative &&
  ((g.navigator && g.navigator.standalone === true) ||
    (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches));

const plugin = (name) => g.Capacitor?.Plugins?.[name] ?? null;

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Preferences on native, localStorage on web.
 *
 * iOS clears localStorage in a WKWebView after seven days without use — which
 * would silently wipe a user's answers between checks, exactly the sort of
 * thing that gets blamed on "the app is broken". Preferences is backed by
 * UserDefaults and survives.
 */
export const store = {
  async get(key) {
    const p = plugin('Preferences');
    if (p) {
      const { value } = await p.get({ key });
      return value ?? null;
    }
    try {
      return g.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const p = plugin('Preferences');
    if (p) return p.set({ key, value });
    try {
      g.localStorage.setItem(key, value);
    } catch {
      /* private mode — accept the loss rather than crash the app */
    }
  },
  async remove(key) {
    const p = plugin('Preferences');
    if (p) return p.remove({ key });
    try {
      g.localStorage.removeItem(key);
    } catch {}
  },
};

/* ------------------------------------------------------------------ */
/* Deadline notifications                                              */
/* ------------------------------------------------------------------ */

/**
 * Schedule OS notifications for grant deadlines.
 *
 * This is the single most valuable native capability here. A grant you miss by
 * a week is worth exactly nothing, and a web page cannot wake you up about it
 * — iOS gives web push only to installed PWAs, and even then not on a
 * schedule months out. A local notification needs no server, no push
 * certificate and no network at the time it fires.
 *
 * Returns the number actually scheduled, which is not always what was asked:
 * both platforms cap pending notifications (iOS at 64), so we take the
 * soonest and say so rather than silently dropping the rest.
 */
export const notifications = {
  available: () => !!plugin('LocalNotifications'),

  async requestPermission() {
    const p = plugin('LocalNotifications');
    if (!p) return 'unsupported';
    const res = await p.requestPermissions();
    return res.display; // 'granted' | 'denied' | 'prompt'
  },

  async schedule(events, { max = 50 } = {}) {
    const p = plugin('LocalNotifications');
    if (!p) return { scheduled: 0, capped: 0, reason: 'unsupported' };

    const perm = await p.checkPermissions();
    if (perm.display !== 'granted') {
      const asked = await p.requestPermissions();
      if (asked.display !== 'granted') return { scheduled: 0, capped: 0, reason: 'denied' };
    }

    /* Clear ours first so a re-check does not double-book every deadline. */
    const pending = await p.getPending();
    if (pending.notifications?.length) {
      await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }

    const now = Date.now();
    const upcoming = events.filter((e) => e.at > now).sort((a, b) => a.at - b.at);
    const take = upcoming.slice(0, max);

    await p.schedule({
      notifications: take.map((e, i) => ({
        id: i + 1,
        title: e.title,
        body: e.body,
        schedule: { at: new Date(e.at), allowWhileIdle: true },
        extra: { url: e.url ?? null },
        smallIcon: 'ic_stat_icon',
      })),
    });

    return { scheduled: take.length, capped: Math.max(0, upcoming.length - take.length), reason: null };
  },

  async cancelAll() {
    const p = plugin('LocalNotifications');
    if (!p) return;
    const pending = await p.getPending();
    if (pending.notifications?.length) {
      await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  },
};

/* ------------------------------------------------------------------ */
/* Biometric lock                                                      */
/* ------------------------------------------------------------------ */

/**
 * Face ID / Touch ID / fingerprint on the document vault.
 *
 * The vault holds payslips, residence permits and disability decisions. On a
 * phone that is handed around or left on a table, a passphrase typed once and
 * remembered is not enough. This gates access to the decrypted view; it is
 * NOT the encryption key — the key is still derived from the passphrase, so a
 * bypassed biometric check still yields ciphertext.
 */
export const biometrics = {
  async available() {
    const p = plugin('NativeBiometric');
    if (!p) return { available: false, kind: null };
    try {
      const r = await p.isAvailable();
      return { available: !!r.isAvailable, kind: r.biometryType ?? null };
    } catch {
      return { available: false, kind: null };
    }
  },

  async verify(reason = 'Unlock your documents') {
    const p = plugin('NativeBiometric');
    if (!p) return true; // no biometry on this device: fall through to the passphrase
    try {
      await p.verifyIdentity({ reason, title: 'Unlisted Grants', subtitle: '', description: '' });
      return true;
    } catch {
      return false;
    }
  },
};

/* ------------------------------------------------------------------ */
/* Sharing and files                                                   */
/* ------------------------------------------------------------------ */

/**
 * Save a generated file (calendar export, application pack) and offer it to
 * the share sheet. On web this becomes an ordinary download, which is the
 * right behaviour there.
 */
export const files = {
  async saveAndShare({ filename, data, mime = 'text/plain', title = 'Unlisted Grants' }) {
    const fsPlugin = plugin('Filesystem');
    const sharePlugin = plugin('Share');

    if (fsPlugin && sharePlugin) {
      const base64 = btoa(unescape(encodeURIComponent(data)));
      const written = await fsPlugin.writeFile({
        path: filename,
        data: base64,
        directory: 'CACHE',
        recursive: true,
      });
      await sharePlugin.share({ title, url: written.uri, dialogTitle: title });
      return { ok: true, via: 'native' };
    }

    /* Web: a plain download. */
    try {
      const blob = new Blob([data], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      return { ok: true, via: 'download' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

/* ------------------------------------------------------------------ */
/* External links                                                      */
/* ------------------------------------------------------------------ */

/**
 * Open a funder's site.
 *
 * Never in the app's own webview: a government portal opened inside our shell
 * would look like it belongs to us, which is precisely the impersonation both
 * stores reject and precisely the confusion a benefits claimant does not need.
 * In-app browser on native, new tab on web.
 */
export async function openExternal(url) {
  const p = plugin('Browser');
  if (p) return p.open({ url, presentationStyle: 'popover' });
  g.open(url, '_blank', 'noopener');
}

/* ------------------------------------------------------------------ */
/* Feedback and chrome                                                 */
/* ------------------------------------------------------------------ */

export async function tap(style = 'light') {
  const p = plugin('Haptics');
  if (!p) return;
  try {
    await p.impact({ style: style.toUpperCase() });
  } catch {}
}

/** Called once at boot to settle the native chrome. */
export async function initShell() {
  if (!isNative) return;
  try {
    await plugin('StatusBar')?.setStyle({ style: 'DARK' });
    await plugin('StatusBar')?.setBackgroundColor({ color: '#000000' });
  } catch {}
  try {
    await plugin('SplashScreen')?.hide();
  } catch {}

  /* Android back button: step back through our own views before letting the
     OS close the app, or the first back press quits from a results screen. */
  const app = plugin('App');
  if (app) {
    app.addListener('backButton', ({ canGoBack }) => {
      if (g.__unclaimedBack && g.__unclaimedBack()) return;
      if (canGoBack) g.history.back();
      else app.exitApp();
    });
  }
}

/** One-line description of where we are running, for the settings screen. */
export function environmentLabel() {
  if (isNative) return platform() === 'ios' ? 'iOS app' : 'Android app';
  if (isInstalledPwa()) return 'Installed web app';
  return 'Browser';
}
