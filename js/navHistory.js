// Tarayıcı/Android "geri" tuşu desteği: uygulama içi sayfa geçişlerini
// history'ye yazar, geri tuşu bir önceki uygulama sayfasına döner
// (önceden tüm sayfa geçişleri tek girişte kaldığı için geri tuşu doğrudan
// giriş sayfasına atıyordu).
window.NavHistory = (function () {
  let showFn = null;
  let popping = false;
  let seq = 0;
  const dataById = new Map();

  function record(page, data) {
    if (popping || !page) return;
    const id = ++seq;
    dataById.set(id, data || {});
    const cur = history.state;
    const state = { eduPage: page, id };
    try {
      if (!cur || !cur.eduPage || cur.eduPage === page) history.replaceState(state, '');
      else history.pushState(state, '');
    } catch (e) { /* history erişilemezse sessizce geç */ }
  }

  function init(fn, rootPage) {
    showFn = fn;
    if (rootPage) record(rootPage);
    window.addEventListener('popstate', (ev) => {
      const st = ev.state;
      if (!st || !st.eduPage || !showFn) return;
      popping = true;
      Promise.resolve(showFn(st.eduPage, dataById.get(st.id) || {}))
        .catch(() => {})
        .finally(() => { popping = false; });
    });
  }

  return { record, init };
})();
