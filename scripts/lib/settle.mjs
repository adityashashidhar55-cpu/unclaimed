/**
 * Wait until the page has stopped MOVING, so a geometry guard reads a page a
 * reader could actually be looking at.
 *
 * Every number qa-screens reports is a distance between two boxes. If the
 * boxes are still travelling when the reading is taken, the report is noise.
 * Measured on /enterprise/ at the moment the old bare `waitForTimeout(200)`
 * handed over: 15 revealed elements still carrying a non-`none` transform and
 * 44 running animations.
 *
 * THREE THINGS THAT LOOK LIKE THE FIX AND ARE NOT:
 *
 * 1. `await page.evaluate(() => Promise.all(document.getAnimations()
 *    .map((a) => a.finished)))` never resolves. Six of /enterprise/'s
 *    animations are infinite CSS keyframes (`drift`, `float`); an infinite
 *    animation's `finished` promise settles never, so this hangs the suite.
 *
 * 2. `waitForFunction(() => every transform === 'none')` can never be true.
 *    The same infinite keyframes leave five elements permanently transformed,
 *    so it burns its whole timeout on every page and measures anyway.
 *
 * 3. `page.waitForFunction(async () => …)` — an ASYNC predicate — silently
 *    always passes. Verified in this sandbox against Playwright: a predicate
 *    that resolves to `false` after 300ms returned SUCCESS in 325ms instead
 *    of timing out, because the truthiness test lands on the pending promise
 *    object rather than on the value it resolves to. So the polling loop
 *    below lives in Node, where `page.evaluate` really does await.
 *
 * What it actually waits for is both halves of "not moving":
 *   · no finite animation or CSS transition is still running, and
 *   · the geometry key is unchanged across two samples `gap` ms apart.
 * Geometry alone is not enough, because the reveal transitions are staggered:
 * one lands, the next starts ~300ms later, and any two samples taken inside
 * that quiet gap agree while the page is still visibly assembling itself.
 */

/* One geometry key, used by the wait and by the guard that checks the wait.
 *
 * Top and bottom of every element under `scope`, EXCEPT elements sitting
 * inside something an infinite animation is permanently translating.
 * Measured on /enterprise/: five `.panel--float` divs run a `float` keyframe
 * with `iterations: Infinity`, so their bounding rect changes every frame
 * forever and no honest wait can ever see them hold still. `drift` is the
 * sixth infinite animation and is deliberately NOT excluded — it runs on
 * `body::before`, a pseudo-element, which moves no real box. Excluding it
 * would empty the key and make stability vacuously true. */
const KEY_SRC = `(scope) => {
  const frozen = new Set();
  for (const a of document.getAnimations()) {
    const eff = a.effect, target = eff && eff.target;
    if (!target || eff.pseudoElement) continue;
    if (eff.getTiming().iterations !== Infinity) continue;
    const movesBoxes = eff.getKeyframes().some((f) =>
      ['transform', 'translate', 'rotate', 'scale', 'top', 'left', 'width', 'height', 'margin'].some((k) => k in f));
    if (movesBoxes) frozen.add(target);
  }
  const skip = (el) => { for (let n = el; n; n = n.parentElement) if (frozen.has(n)) return true; return false; };
  const boxes = [...document.querySelectorAll(scope)].filter((e) => !skip(e)).map((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.top) + ':' + Math.round(r.bottom);
  });
  const moving = document.getAnimations().some((a) =>
    a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity);
  return { key: boxes.join('|'), moving: moving };
}`;

const sample = (page, scope) =>
  page.evaluate(({ scope, src }) => new Function('return ' + src)()(scope), { scope, src: KEY_SRC });

/** Returns how long it waited, in ms. Never throws, never hangs past `timeout`. */
export async function settle(page, { timeout = 6000, gap = 120, scope = 'main *' } = {}) {
  const started = Date.now();
  let prev = null;
  while (Date.now() - started < timeout) {
    let now;
    try {
      now = await sample(page, scope);
    } catch {
      break; /* navigated or closed mid-read; nothing left to settle */
    }
    if (!now.moving && prev === now.key) break;
    prev = now.key;
    await page.waitForTimeout(gap);
  }
  return Date.now() - started;
}

/** The same geometry key, read from Node, so a guard can compare two moments. */
export const geometryKey = async (page, scope = 'main *') => (await sample(page, scope)).key;
