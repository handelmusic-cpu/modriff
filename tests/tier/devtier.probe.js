/* The Test as override must not outlive a real purchase. Run: node tests/tier/devtier.probe.js
   Stands in for the store with a stub that says "bought", on the local page (where the Test as row exists). */
'use strict';
const L = require('../layout/lib.js');
(async () => {
  const h = await L.start(); const { page } = await L.boot(h, 'p390', 'studio');
  const r = await page.evaluate(async () => {
    const out = {};
    devTierSet('free');
    out.freeNone = !MODULE_ORDER.some(modHas);
    out.keyAfterFree = localStorage.getItem('modo-dev-tier');
    out.purchasesActiveWhileFree = document.querySelector('[data-devtier="real"]').classList.contains('active');
    window.modBilling.purchase = () => Promise.resolve(true);
    proSheet('', 'theory');
    const unlock = [...document.querySelectorAll('#_pro-sheet .pro-buy')][0];
    out.hadUnlockButton = !!unlock;
    unlock.click();
    await new Promise(r => setTimeout(r, 400));
    out.overrideCleared = window.modBilling._dev == null;
    out.keyAfterBuy = localStorage.getItem('modo-dev-tier');
    out.theoryHeld = modHas('theory');
    // 'Purchases' by hand
    devTierSet('free'); devTierSet('real');
    out.manualClear = window.modBilling._dev == null && localStorage.getItem('modo-dev-tier') == null;
    // A pack toggled on in Test as shows Owned and offers no buy button; Purchases puts the buy button back
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = r.freeNone && r.keyAfterFree === 'free' && !r.purchasesActiveWhileFree && r.hadUnlockButton && r.overrideCleared && r.keyAfterBuy === null && r.theoryHeld && r.manualClear;
  console.log(ok ? 'PASS' : 'FAIL'); await h.close(); process.exit(ok ? 0 : 1);
})();
