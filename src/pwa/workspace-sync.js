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
/* Where an anonymous board goes when a server copy displaces it. */
const STRANDED_KEY = 'unclaimed.workspace.stranded';
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

  /* The server has a document, and this browser may also have one that was
     built before signing in. The old code called writeLocal(serverDoc) here
     unconditionally, which erased that anonymous work with no warning, no
     merge and no export — the exact failure the module header promises not to
     have. It only looked safe because the common case is an empty local board.

     Two portfolios cannot be merged automatically: which of two different
     headcounts for the same company is right is a question only a person can
     answer. So the local copy is preserved under a recovery key and reported,
     and the UI offers it as a download. The server copy still wins on screen,
     because it is the one the team can see. */
  const local = readLocal();
  let stranded = false;
  if (hasContent(local) && JSON.stringify(local) !== JSON.stringify(serverDoc)) {
    try {
      localStorage.setItem(STRANDED_KEY, JSON.stringify({ at: Date.now(), doc: local }));
      stranded = true;
    } catch {
      /* No room to stash it. Better to say nothing than to claim a rescue we
         did not perform — `stranded` stays false and the copy is overwritten,
         which is the pre-existing behaviour and the only option left. */
    }
  }

  writeLocal(serverDoc);
  writeRev(serverRev);
  return { status: STATUS.READY, doc: serverDoc, rev: serverRev, email: me.body.email, scope: ws.body.scope, stranded };
}

/** The anonymous board that was displaced by a server copy, if there is one. */
export function readStranded() {
  try {
    return JSON.parse(localStorage.getItem(STRANDED_KEY));
  } catch {
    return null;
  }
}

export function clearStranded() {
  try {
    localStorage.removeItem(STRANDED_KEY);
  } catch {
    /* Nothing to do; it is only a recovery copy. */
  }
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
  /* Set for exactly one turn of the loop, to stop the retry below re-sending a
     document that has just lost a conflict. */
  let conflictFailed = false;

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
        /* Drop anything queued. It was composed against the revision we just
           lost, so re-sending it would succeed at the NEW revision and erase
           the colleague's save we were just told about — silently, while the
           screen shows their version. The user would reload and watch the
           board flip back to the copy they had been told they lost.
           
           The losing document is handed to onConflict instead, so it can be
           offered as an export rather than thrown away or force-pushed. */
        const losing = pending ?? doc;
        pending = null;
        conflictFailed = true;
        onState('conflict');
        if (onConflict) onConflict(res.doc ?? null, rev, losing);
      } else {
        /* A failed push must not lose the document. `pending` was cleared
           before the await, so without this the edit exists only in
           localStorage and never reaches the server again unless the user
           happens to type something else. */
        if (pending === null) pending = doc;
        onState('error');
      }
    } catch {
      if (pending === null) pending = doc;
      onState('error');
    } finally {
      inFlight = false;
      /* Something arrived while we were writing. Go again rather than drop it —
         but never straight after a conflict, for the reason above. */
      if (pending !== null && !conflictFailed) setTimeout(flush, 0);
      conflictFailed = false;
    }
  }

  return {
    /** Call on every mutation. Cheap, debounced, never blocks. */
    queue(doc) {
      pending = doc;
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    /**
     * Force a write now — used on page hide, so a closed tab does not lose the
     * last edit.
     *
     * `flush()` returns immediately when a save is already in flight, and the
     * usual `setTimeout` retry never runs because the page is unloading. So
     * when that happens the edit is written with `sendBeacon`, which the
     * browser is obliged to deliver after the page is gone. It carries no
     * cookies in some engines, hence the token when we have one — and if
     * neither is available the local copy is still intact, which is the
     * failure we can live with.
     */
    flushNow() {
      clearTimeout(timer);
      if (!inFlight || pending === null) return flush();
      try {
        const body = JSON.stringify({ rev, doc: pending });
        navigator.sendBeacon?.('/api/workspace', new Blob([body], { type: 'application/json' }));
      } catch {
        /* Nothing more we can do at unload. localStorage still has it. */
      }
      return Promise.resolve();
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
