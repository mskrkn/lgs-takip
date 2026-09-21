// Geçici şifreyle giriş yapmış kullanıcı (bkz. server.py _enforce_password_change)
// herhangi bir API çağrısında "passwordChangeRequired" alırsa şifre belirleme
// sayfasına yönlendirilir.
(function () {
  const orig = window.fetch;
  window.fetch = async function (...args) {
    const res = await orig.apply(this, args);
    if (res.status === 403) {
      try {
        const j = await res.clone().json();
        if (j && j.passwordChangeRequired) window.location.replace('/sifre-degistir.html');
      } catch (_) { /* JSON degil */ }
    }
    return res;
  };
})();
