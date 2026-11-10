# Original login scene

`vendor/login-scene/runtime.original.js` is copied unchanged from the user's local archived website:

`D:/designs/ee083be0-2c52-4abb-9a42-d6c84662829a/plugins/soulecho-hero/assets/runtime.js`

SHA-256: `D1E64559335C58C0269755C912FD59C140C6A4183B2FF920BD71D7B595DF1C28`

The bundle contains the original Three.js version, geometries, globe shaders, particle/fragment effects, terrain and CRT post-processing. Its existing source comments and copyright notices are preserved. The archive does not include the separate `main.js.LICENSE.txt` referenced in its header.

`scripts/prepare-login-scene.mjs` verifies this SHA-256 and generates the public `runtime.js` before development and production builds. The integration loops only the inner and outer globe clocks every **15 seconds**, as requested. The terrain and post-processing clocks keep advancing, and all original shaders, geometry and animation parameters remain unchanged. A read-only timing accessor supports browser verification. The generated public bundle is not checked into Git.

`scene.html` supplies the DOM expected by that runtime. The only visual configuration override is a transparent title texture, which removes the archived site's SoulEcho title without changing the scene's algorithms or parameters. It waits for a nonzero viewport before loading the bundle.

`still.png` is a browser capture of this original scene without any overlaid interface. It is used only for the reduced-motion experience.

The Vue application embeds the scene as a decorative sandboxed iframe in `App.vue`, outside the route view. It remains fixed under all pages and is not remounted by normal route changes. Enabling reduced motion replaces its document with `still.png`; removing the component/application removes its animation loops and event handlers together.
