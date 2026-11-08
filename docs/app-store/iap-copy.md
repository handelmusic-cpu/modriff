# In-App Purchases: proposed copy and promo images

All eleven are Non-Consumable, Family Sharing on. Name max 30, description max 45 characters.
The live copy is `MODULE_COPY` / `BUNDLE_COPY` in `index.html` and `ios/App/ModRiffPacks.storekit`
(a test holds them together). The descriptions below are proposals: to adopt them, change those
two places and run `tests/tier/registry.test.js`. Promo images: `iap-promo/<product id>.png`
(1024 x 1024, regenerate with `iap-promo/render.sh`).

| Product ID | Display name | Description (45 max) | Price |
|---|---|---|---|
| `Handel.modRiff.sampler` | Sampler Engine | Pro sampler: your samples, kits, loop slicing | $5.99 |
| `Handel.modRiff.synth` | mõdSynth Engine | Wavetable power synth + the full mõdFX rack | $4.99 |
| `Handel.modRiff.groove` | Groove Pack | World grooves, odd meters, extra kits, aux | $3.99 |
| `Handel.modRiff.theory` | Theory Pack | Every mode, chord and voicing, neo-soul ready | $3.99 |
| `Handel.modRiff.practice` | Practice & Perform Pack | Speed trainer, loop bars, Stage, timeline | $3.99 |
| `Handel.modRiff.studio` | Studio Pack | Stems, full audio and MIDI export, no limits | $4.99 |
| `Handel.modRiff.sounds` | Sounds Pack | Tonewheel organ, e-piano, pads, vibes, bass | $1.99 |
| `Handel.modRiff.fullstudio` | Full Studio | Every pack, in one purchase | $12.99 |
| `Handel.modRiff.fullstudio.from1` | Complete Your Studio | Finish the set: every pack you don’t own yet | $10.99 |
| `Handel.modRiff.fullstudio.from2` | Complete Your Studio | Finish the set: every pack you don’t own yet | $6.99 |
| `Handel.modRiff.fullstudio.from3plus` | Complete Your Studio | Finish the set: every pack you don’t own yet | $3.99 |
