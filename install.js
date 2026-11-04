// Home Screen uses the same workbench. Do not transfer or persist pairing secrets.
(() => {
  const mode = window.matchMedia('(display-mode: standalone)');
  function update() {
    document.documentElement.classList.toggle('standalone-app', mode.matches || navigator.standalone === true);
  }
  update();
  mode.addEventListener?.('change', update);
})();

setTimeout(()=>{if(!globalThis.bridgeWorkbenchReady){const p=document.getElementById('pairError');if(p)p.textContent='网页未能完整加载。请检查网络后刷新；若仍失败，请暂停配对并检查新版发布，不要绕过浏览器安全提示。';}},15000);
