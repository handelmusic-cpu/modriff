# IAP review screenshots

Eleven distinct native Simulator captures from 1.9.9.9.2, 1320 × 2868, opaque. `verification.json` records the actual sheet text, ownership state and final image hashes. Studio includes EQ; Theory includes pure tuning; Practice uses the current playlist-import wording. The backdrop is the current Live layout.

Launch prices come from the table in `docs/app-store.md` and are supplied only to the disposable capture bundle’s provider. These images verify presentation, not a StoreKit purchase. The upgrade shots own Groove; Groove and Sounds; Groove, Sounds and Studio.

To recapture: build an optimized Debug Simulator app, run `npm run build` and `cap sync ios`, then set `MODRIFF_SIM_APP` to the compiled `App.app` and run `python3 source/capture.py`. It uses only `ss-iPhone18PM`, appends `capture.js` to a disposable bundle under `MODRIFF_CAPTURE_WORK` (default `/private/tmp/modriff-layout-assets`), and replaces these eleven PNGs. Check dimensions and remove alpha before upload; regenerate the verification hashes after that conversion.
