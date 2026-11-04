// Home Screen uses the same workbench. Do not transfer or persist pairing secrets.
(() => {
  const mode = window.matchMedia('(display-mode: standalone)');
  function update() {
    document.documentElement.classList.toggle('standalone-app', mode.matches || navigator.standalone === true);
  }
  update();
  mode.addEventListener?.('change', update);
})();
