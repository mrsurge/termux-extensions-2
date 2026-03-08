#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BASHRC="$HOME/.bashrc"
ANDROID_SDK="$HOME/Android/Sdk"

START_MARK="# >>> termux-android-sdk >>>"
END_MARK="# <<< termux-android-sdk <<<"

if [ ! -f "$BASHRC" ]; then
  touch "$BASHRC"
fi

# Remove existing managed block if present, then append a fresh one.
tmp="$(mktemp)"
awk -v s="$START_MARK" -v e="$END_MARK" '
  $0==s {skip=1; next}
  $0==e {skip=0; next}
  !skip {print}
' "$BASHRC" > "$tmp"
cat "$tmp" > "$BASHRC"
rm -f "$tmp"

cat >> "$BASHRC" <<EOB

$START_MARK
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export JAVA_HOME="\$PREFIX/lib/jvm/java-17-openjdk"
export PATH="\$JAVA_HOME/bin:\$PATH"
$END_MARK
EOB

echo "Updated $BASHRC"

# Best effort: stop Gradle daemon assuming script is run from repo root.
if [ -x "./gradlew" ]; then
  ./gradlew --stop || true
else
  echo "./gradlew not found in current directory; skipping daemon stop."
fi

echo "Done. Run: . ~/.bashrc (or open a new shell)"
