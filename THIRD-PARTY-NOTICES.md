# Third-party notices

RpRoll's own code, dice models, board and icons are under the MIT License (see `LICENSE`). These parts are not, and keep their own terms. The page build (`web-src/build.mjs`) copies the same notices into the mod's `client/web/fonts/` and `client/web/licenses/`, so they travel with the mod.

| Part | Where | Author | Licence |
|---|---|---|---|
| three.js 0.185.1 | bundled into `client/web/app.js` from npm | three.js authors | MIT, `web-src/node_modules/three/LICENSE` after `npm install`, copied to `client/web/licenses/three.LICENSE.txt` |
| Cinzel Bold | `web-src/assets/fonts/Cinzel-Bold.ttf` | The Cinzel Project Authors (Natanael Gama) | SIL Open Font License 1.1, `web-src/assets/fonts/OFL.txt` |
| Kingthings Petrock, Kingthings Petrock Light | `web-src/assets/fonts/Kingthings Petrock*.ttf` | Kevin King, kingthingsfonts.co.uk | Free for any use, files must stay unchanged, `web-src/assets/fonts/kingthingsEULA.txt` |

The Kingthings font files are the author's originals, byte for byte, as his EULA asks. Don't convert or subset them.

Build and test tools (esbuild, puppeteer-core, xUnit, the OB:MP SDK and chat packages from NuGet) are used to build or test RpRoll and are not part of this repository. The OB:MP SDK and chat packages are ReadyM's, under ReadyM's terms.
