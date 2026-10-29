// Apply the saved theme before rendering to avoid a flash.
(function () {
  try {
    var t = localStorage.getItem('homecoin-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage not available */ }
})();
