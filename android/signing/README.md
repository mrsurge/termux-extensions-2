# TE2 Android development signing

`te2-development.keystore` is the canonical, repository-owned signing identity
for GeckoView and Cefrium **debug and staging builds only**. It deliberately
uses the conventional Android debug alias and password (`androiddebugkey` /
`android`). It is not a secret and must never sign a release build.

Keeping this one insecure-by-design development certificate in the repository
lets APKs built on Linux and Termux update one another without each machine's
automatically generated `$HOME/.android/debug.keystore` changing the package
identity.

Canonical SHA-256 certificate fingerprint:

```text
50:0D:5F:BD:6F:4C:B3:FF:75:5F:D2:FC:2D:23:F7:87:50:D0:CC:14:75:56:15:DC:4D:0B:45:1F:63:35:E3:4D
```

An installation signed by a former machine-local debug key must be removed
once before installing the first APK signed by this development identity.
Subsequent debug and staging builds from every checkout use the same key.
