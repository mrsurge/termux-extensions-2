# TE2 xterm Vendor Assets

`xterm.js` and `xterm.css` are generated from the local xterm fork at
`worktrees/xterm-te2`, branch `te2-mobile-touch-routing`. The currently
published source commit is `1d71ed0732d592980eb0960ce3da001213d2636e`; that
branch is based on upstream tag `5.3.0`
(`2e02c37e528c1abc200ce401f49d0d7eae330e63`).
The published source origin is `https://github.com/mrsurge/xterm-te2`.

Do not edit the minified browser bundle directly. Modify and validate the fork,
run its browser TypeScript build and webpack package step, then copy
`lib/xterm.js` and `css/xterm.css` into this directory. The detailed validation,
publication, and rebase instructions are in `worktrees/xterm-te2/TE2_PATCH_GUIDE.md`.

The Code TE2 drawer, standalone Terminal, and File Explorer terminal load a patched build of `xterm-addon-webgl@0.16.0`
after opening xterm. Its browser bundle and MIT license are vendored here. The
scoped 0.17.0 and 0.19.0 releases failed activation against this 5.3.0 fork.
This renderer trial does not change the PTY, headless worker, or xterm core.

To rebuild the WebGL addon, use a separate checkout of upstream xterm.js at
`2e02c37e528c1abc200ce401f49d0d7eae330e63` (5.3.0). Set `TE2` to the
absolute path of this repository and run from that upstream checkout:

```sh
git apply "$TE2/scripts/patches/xterm-webgl-atlas-font.patch"
yarn install --frozen-lockfile --ignore-scripts --ignore-engines
./node_modules/.bin/tsc -b addons/xterm-addon-webgl/src
(cd addons/xterm-addon-webgl && ../../node_modules/.bin/webpack)
cp addons/xterm-addon-webgl/lib/xterm-addon-webgl.js "$TE2/app/static/vendor/xterm/"
```

The patch trims the glyph atlas canvas font shorthand. On Electromux an
empty italic prefix otherwise leaves ordinary and bold glyphs rasterized
with the previous canvas font, even though the cell geometry is correct.
