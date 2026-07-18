# TE2 xterm Vendor Assets

`xterm.js` and `xterm.css` are generated from the local xterm fork at
`worktrees/xterm-te2`, branch `te2-android-ime`. That branch is based on
upstream tag `5.3.0` (`2e02c37e528c1abc200ce401f49d0d7eae330e63`).
The published source origin is `https://github.com/mrsurge/xterm-te2`.

Do not edit the minified browser bundle directly. Modify and validate the fork,
run its browser TypeScript build and webpack package step, then copy
`lib/xterm.js` and `css/xterm.css` into this directory. The detailed validation,
publication, and rebase instructions are in `worktrees/xterm-te2/TE2_PATCH_GUIDE.md`.
