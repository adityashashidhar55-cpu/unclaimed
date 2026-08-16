/**
 * The workspace, on the server.
 *
 * It used to live in one localStorage key and nowhere else. That is a fine
 * place to start — it works before you have an account, and a fund can try it
 * on a real portfolio without the portfolio leaving the building — and it is
 * not a product. Per-browser means a workspace does not survive a new laptop,
 * a cleared cache, or a second person on the team, and "one shared pipeline"
 * is most of what an enterprise buyer is paying for.
 *
 * So: the server is the source of truth when you are signed in, localStorage
 * is the offline cache and the anonymous scratchpad, and this module is the
 * seam between them.
 *
 * Three things it has to get right, in order of how badly they hurt:
 *
 *   1. Never lose work. A failed save must be visible, and a conflict must
 *      never be resolved by throwing one side away silently.
 *   2. Never block typing. Saves are debounced and fire-and-forget; the UI
 *      commits locally first and reconciles after.
 *   3. Never strand the anonymous workspace. Someone who built a portfolio
 *      before signing up must find it there afterwards, not an empty board.
 */

const LOCAL_KEY = 'unclaimed.workspace.v1';
const REV_KEY = 'unclaimed.workspace.rev';
const SAVE_DEBOUNCE_MS = 1200;

/** 'offline' until we know better — never assume entitled. */
export const STATUS = {
  CHECKING: 'checking',
  SIGNED_OUT: 'signed_out',
  NOT_ENTITLED: 'not_entitled',
  READY: 'ready',
  OFFLINE: 'offline',
};

const jsonFetch = async (url, init = {}) => {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* A non-JSON body from an API route means something upstream answered
       instead — a proxy error page, usually. Treat it as a failure with no
       detail rather than throwing inside a parse. */
  }
  return { ok: res.ok, status: res.status, body };
};

export function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY));
  } catch {
    return null;
  }
}

export function writeLocal(doc) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
    return true;
  } catch {
    /* Quota, or Safari private mode. The caller surfaces this: a workspace
       that looks saved and is not is the worst failure this product has. */
    return false;
  }
}

const readRev = () => Number(localStorage.getItem(REV_KEY) || 0) || 0;
const writeRev = (r) => {
  try {
    localStorage.setItem(REV_KEY, String(r));
  } catch {
    /* Losing the revision only costs one conflict round-trip. */
  }
};

/** Is anything in this document worth uploading, or is it a blank board? */
export function hasContent(doc) {
  if (!doc) return false;
  return ['companies', 'pipeline', 'projects', 'documents', 'postaward', 'awards', 'grants'].some(
    (k) => Array.isArray(doc[k]) && doc[k].length > 0,
  );
}

/**
 * Work out where we stand: signed in, entitled, and what the server holds.
 *
 * The anonymous-to-signed-in handover happens here. If the server has nothing
 * and this browser has a workspace with real content in it, that local
 * workspace is adopted as revision 1 — otherwise someone who spent an
 * afternoon loading a portfolio and then subscribed would be shown an empty
 * board as their reward.
 */
export async function open() {
  const me = await jsonFetch('/api/me');
  if (!me.ok || !me.body) return { status: STATUS.OFFLINE, doc: readLocal(), rev: 0 };
  if (!me.body.signed_in) return { status: STATUS.SIGNED_OUT, doc: readLocal(), rev: 0 };

  const ws = await jsonFetch('/api/workspace');
  if (ws.status === 401) return { status: STATUS.SIGNED_OUT, doc: readLocal(), rev: 0 };
  if (ws.status === 402) {
    return { status: STATUS.NOT_ENTITLED, doc: readLocal(), rev: 0, email: me.body.email, entitlement: ws.body?.entitlement };
  }
  if (!ws.ok) return { status: STATUS.OFFLINE, doc: readLocal(), rev: 0, email: me.body.email };

  const serverDoc = ws.body.doc;
  const serverRev = ws.body.rev ?? 0;

  if (serverRev === 0 && !serverDoc) {
    const local = readLocal();
    if (hasContent(local)) {
      const saved = await push(local, 0);
      if (saved.ok) {
        writeRev(saved.rev);
        return { status: STATUS.READY, doc: local, rev: saved.rev, email: me.body.email, adopted: true };
      }
    }
    writeRev(0);
    return { status: STATUS.READY, doc: null, rev: 0, email: me.body.email };
  }

  writeLocal(serverDoc);
  writeRev(serverRev);
  return { status: STATUS.READY, doc: serverDoc, rev: serverRev, email: me.body.email, scope: ws.body.scope };
}

/** One save. Returns {ok, rev} or {ok:false, conflict, doc, rev}. */
export async function push(doc, rev) {
  const res = await jsonFetch('/api/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev, doc }),
  });
  if (res.ok) return { ok: true, rev: res.body.rev };
  if (res.status === 409) {
    return { ok: false, conflict: true, rev: res.body?.rev ?? rev, doc: res.body?.doc ?? null };
  }
  return { ok: false, status: res.status, message: res.body?.message };
}

/**
 * A debounced saver bound to one workspace.
 *
 * `onState` is called with 'saving' | 'saved' | 'error' | 'conflict' so the UI
 * can say something true about whether the work is safe. A silent save is fine
 * when it works and unforgivable when it does not.
 *
 * On conflict the server's document is handed to `onConflict` rather than
 * merged here. Merging two portfolios is a product decision, not a transport
 * one, and guessing wrong loses work.
 */
export function createSaver({ onState = () => {}, onConflict = null } = {}) {
  let timer = null;
  let pending = null;
  let rev = readRev();
  let inFlight = false;

  async function flush() {
    if (inFlight || pending === null) return;
    const doc = pending;
    pending = null;
    inFlight = true;
    onState('saving');
    try {
      const res = await push(doc, rev);
      if (res.ok) {
        rev = res.rev;
        writeRev(rev);
        onState('saved');
      } else if (res.conflict) {
        rev = res.rev;
        writeRev(rev);
        onState('conflict');
        if (onConflict && res.doc) onConflict(res.doc, rev);
      } else {
        onState('error');
      }
    } catch {
      onState('error');
    } finally {
      inFlight = false;
      /* Something arrived while we were writing. Go again rather than drop it. */
      if (pending !== null) setTimeout(flush, 0);
    }
  }

  return {
    /** Call on every mutation. Cheap, debounced, never blocks. */
    queue(doc) {
      pending = doc;
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    /** Force a write now — used on page hide, so a closed tab does not lose the last edit. */
    flushNow() {
      clearTimeout(timer);
      return flush();
    },
    setRev(r) {
      rev = r;
      writeRev(r);
    },
    get rev() {
      return rev;
    },
  };
}
