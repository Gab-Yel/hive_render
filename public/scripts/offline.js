// scripts/offline.js
// -----------------------------------------------------------------------------
// Small, dependency-free offline layer (localStorage cache + a write queue —
// no IndexedDB/service worker, to match the rest of this project's
// no-build-step style). Two things it enables:
//
//  1. bootAuth() (auth.js) can let a previously-logged-in person back into
//     the app even with no signal, instead of bouncing them to the login
//     screen just because /auth/me couldn't be reached.
//  2. The Personal page (personal.js) keeps working offline: reads fall
//     back to the last-synced copy, and writes (adding an expense, marking
//     a debt paid, etc.) are queued and replayed automatically once the
//     connection comes back.
//
// Everything else in the app (Finance, Hive) still needs a connection —
// that data is shared with roommates, so making it work offline means
// solving conflict resolution, which is a much bigger project. Scoping
// offline support to Personal (single-user data, no conflicts) keeps this
// honest and reliable instead of half-working everywhere.
// -----------------------------------------------------------------------------

const Offline = {
  isOnline() {
    return navigator.onLine;
  },

  // ---- Read cache -----------------------------------------------------------
  // The last-known-good response for a given GET path, so the UI has
  // *something* to show when there's no connection.
  _cacheKey(path) {
    return `hive_cache:${path}`;
  },
  cacheGet(path) {
    const raw = localStorage.getItem(this._cacheKey(path));
    return raw ? JSON.parse(raw) : null;
  },
  cacheSet(path, data) {
    try {
      localStorage.setItem(this._cacheKey(path), JSON.stringify(data));
    } catch (_) {
      // Storage full/unavailable — non-fatal, just means no offline
      // fallback for this particular path next time.
    }
  },

  // GET with an automatic cache fallback. Tries the network first (so data
  // is always as fresh as possible when there IS a connection), saves a
  // copy on success, and silently falls back to the last cached copy if the
  // request fails for any reason (offline, timeout, server hiccup).
  async get(path) {
    if (!this.isOnline()) {
      const cached = this.cacheGet(path);
      if (cached) return { data: cached, fromCache: true };
      throw new Error("You're offline and there's nothing saved yet for this.");
    }
    try {
      const data = await api(path);
      this.cacheSet(path, data);
      return { data, fromCache: false };
    } catch (err) {
      const cached = this.cacheGet(path);
      if (cached) return { data: cached, fromCache: true };
      throw err;
    }
  },

  // ---- Write queue ------------------------------------------------------------
  // For POST/DELETE/PATCH/PUT calls made while offline. Queued writes are
  // replayed in the order they were made once the connection returns.
  _queueKey: "hive_sync_queue",
  queueList() {
    const raw = localStorage.getItem(this._queueKey);
    return raw ? JSON.parse(raw) : [];
  },
  _queueSave(list) {
    localStorage.setItem(this._queueKey, JSON.stringify(list));
  },
  queuePush(action) {
    const list = this.queueList();
    list.push({ ...action, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    this._queueSave(list);
    this._notify();
    return list;
  },
  pendingCount() {
    return this.queueList().length;
  },
  _notify() {
    document.dispatchEvent(new CustomEvent("hive:sync-queue-changed", { detail: { pending: this.pendingCount() } }));
  },

  // Write with an offline fallback: tries the network immediately if we
  // look online; if that fails for a network reason (not a real server
  // rejection like bad input), or we're offline to begin with, it queues
  // the write and returns null so the caller can apply its own optimistic
  // local update to the UI/cache.
  async write(path, options) {
    if (this.isOnline()) {
      try {
        return await api(path, options);
      } catch (err) {
        if (err.status) throw err; // real server error — surface it, don't queue
        // else: fetch itself failed even though navigator says we're online
        // (flaky connection) — fall through to queueing below
      }
    }
    this.queuePush({ path, options });
    return null;
  },

  // Replays every queued write against the real server, in order. Stops on
  // the first network failure so nothing applies out of order — whatever's
  // left in the queue just retries next time we're back online. Server-side
  // rejections (bad input etc.) are dropped rather than retried forever.
  async flush() {
    if (!this.isOnline()) return;
    let list = this.queueList();
    while (list.length) {
      const next = list[0];
      try {
        await api(next.path, next.options);
      } catch (err) {
        if (!err.status) break; // still can't actually reach the server — stop here
        // otherwise: server said no — drop this one and keep going
      }
      list = list.slice(1);
      this._queueSave(list);
      this._notify();
    }
  },
};

window.addEventListener("online", () => {
  Offline.flush().then(() => {
    document.dispatchEvent(new Event("hive:back-online"));
  });
});
