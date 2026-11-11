// חיבור האפליקציה לשרת של גוגל (Apps Script) במקום ל-claude.ai.
// מספק לדף את אותו ממשק שהוא מכיר (claude.use('db') / claude.use('downloads')), עם משיכת שינויים כל כמה שניות.
(function () {
  const API = window.APP_API;
  const POLL_MS = 8000;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  };
  const docs = new Map();          // path -> data
  const subs = new Set();          // {match(path), fire()}
  let since = 0, timer = null, loaded = false, syncing = null;

  async function call(body) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, pw: store.get('kh_pw') || '' }) });
    const out = await res.json();
    if (!out.ok) {
      if (out.error === 'bad_password' && body.op !== 'login') { store.set('kh_pw', null); window.appSignedOut?.(); }
      throw { code: out.error === 'not_found' ? 'invalid_argument' : out.error === 'bad_password' ? 'invalid_argument' : 'unavailable', message: out.error };
    }
    return out;
  }
  function notify(paths) { for (const s of subs) if (!paths || paths.some(p => s.match(p))) s.fire(); }
  async function sync() {
    if (!store.get('kh_pw')) return;
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const out = await call({ op: 'sync', since });
        const changed = [];
        if (out.full) docs.clear();
        for (const d of out.docs) { if (d.data === null) docs.delete(d.path); else docs.set(d.path, d.data); changed.push(d.path); }
        since = Math.max(0, out.now - 10000); // overlap so a write that lands mid-sync is not missed
        const first = !loaded; loaded = true;
        if (first) notify(); else if (changed.length) notify(changed);
      } catch (e) { /* next poll retries */ } finally { syncing = null; }
    })();
    return syncing;
  }
  function start() {
    if (timer) return;
    sync();
    timer = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  }
  const freeze = d => (d == null ? undefined : JSON.parse(JSON.stringify(d)));
  const docSnap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => freeze(docs.get(path)), metadata: { fromCache: !loaded, hasPendingWrites: false } });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  async function write(op, path, data) {
    const prev = docs.has(path) ? docs.get(path) : undefined;
    if (op === 'set') docs.set(path, freeze(data));
    else if (op === 'update') { if (prev === undefined) throw { code: 'invalid_argument', message: 'not_found' }; docs.set(path, { ...prev, ...freeze(data) }); }
    else docs.delete(path);
    notify([path]);
    try {
      const out = await call({ op, path, data });
      if (out.data === null) docs.delete(path); else docs.set(path, out.data);
      notify([path]);
    } catch (e) {
      if (prev === undefined) docs.delete(path); else docs.set(path, prev);
      notify([path]);
      throw e;
    }
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => { await sync(); return docSnap(path); },
      set: d => write('set', path, d),
      update: d => write('update', path, d),
      delete: () => write('delete', path),
      onSnapshot(next) {
        const s = { match: p => p === path, fire: () => next(docSnap(path)) };
        subs.add(s); if (loaded) s.fire(); start();
        return () => subs.delete(s);
      },
      collection: sub => collRef(path + '/' + sub)
    };
  }
  function collRef(path, order, max) {
    const depth = path.split('/').length + 1;
    const inColl = p => p.startsWith(path + '/') && p.split('/').length === depth;
    const snap = () => {
      let list = [...docs.keys()].filter(inColl);
      if (order) list.sort((a, b) => { const x = docs.get(a)[order.f], y = docs.get(b)[order.f]; return (x > y ? 1 : x < y ? -1 : 0) * (order.dir === 'desc' ? -1 : 1); });
      else list.sort();
      if (max) list = list.slice(0, max);
      const ds = list.map(docSnap);
      return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: !loaded, hasPendingWrites: false } };
    };
    return {
      path,
      doc: id => docRef(path + '/' + (id || newId())),
      add: async d => { const r = docRef(path + '/' + newId()); await r.set(d); return r; },
      orderBy: (f, dir) => collRef(path, { f, dir }, max),
      limit: n => collRef(path, order, n),
      get: async () => { await sync(); return snap(); },
      onSnapshot(next) {
        const s = { match: inColl, fire: () => next(snap()) };
        subs.add(s); if (loaded) s.fire(); start();
        return () => subs.delete(s);
      }
    };
  }
  const db = { doc: docRef, collection: p => collRef(p) };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: 'saved' };
    }
  };

  window.claude = { use: async name => (name === 'db' ? db : name === 'downloads' ? downloads : null) };
  // הכניסה נבדקת בשרת. אחרי סיסמה נכונה היא נשמרת בטלפון עד "יציאה".
  window.appLogin = async pw => {
    store.set('kh_pw', pw);
    try { await call({ op: 'login' }); since = 0; loaded = false; await sync(); notify(); return true; }
    catch (e) { store.set('kh_pw', null); return e.message === 'locked' ? 'locked' : e.message === 'bad_password' ? false : 'offline'; }
  };
  window.appLogout = () => { store.set('kh_pw', null); };
  window.appHasLogin = () => !!store.get('kh_pw');
})();
