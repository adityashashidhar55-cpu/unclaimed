/**
 * The only way any page reaches analytics — and the reason a blocked tracker
 * can no longer take sign-in, checkout or the check down with it.
 *
 * beacon.js used to be imported statically by auth.js, checkout.js, app.js,
 * startup-check.js, the account page and the site-wide shell. A static import
 * that fails does not fail alone: the browser abandons the whole module graph
 * that depends on it. And "beacon.js" is exactly the kind of filename tracker
 * blockers stop — NordVPN Threat Protection answers it with an empty 204,
 * uBlock, AdGuard and Brave have rules of the same shape. So for every visitor
 * running one, the account page's script never ran, the sign-in form fell
 * back to a plain HTML submit that reloaded the page with the email in the URL,
 * no code was requested, no email was sent, and nothing anywhere logged an
 * error. The owner saw it as "none of the messages are being sent".
 *
 * So the rule is now structural: nothing imports beacon.js statically. This
 * file is the static import; it loads the real beacon with a dynamic import()
 * whose failure is caught and forgotten. Blocked analytics now means no
 * analytics for that visitor — which is what they asked their blocker for —
 * and the product works exactly the same.
 *
 * The filename is deliberately dull. It is imported statically, so it must
 * never look like something a tracker list would match.
 */

let impl = null;
let dead = false;
const pending = [];

/* Same directory as this file, same cache-busting query this file was loaded
   with — so a deploy that bumps ?v= on the importer bumps it here too, and the
   packaged app (which strips ?v=) asks for the bare file it actually ships. */
const here = new URL(import.meta.url);
import(new URL(`./beacon.js${here.search}`, here).href)
  .then((m) => {
    impl = typeof m.track === 'function' ? m.track : null;
    if (!impl) { dead = true; pending.length = 0; return; }
    for (const args of pending.splice(0)) {
      try { impl(...args); } catch { /* analytics never breaks a page */ }
    }
  })
  .catch(() => { dead = true; pending.length = 0; });

export function track(...args) {
  try {
    if (impl) return impl(...args);
    if (!dead && pending.length < 50) pending.push(args);
  } catch {
    /* analytics never breaks a page */
  }
}
