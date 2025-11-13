#!/data/data/com.termux/files/usr/bin/bash

# Build script for Termux Extensions Android app
# Uses Termux native build tools (AAPT2, Gradle)

set -e

cd "$(dirname "$0")/../android"

echo "🔨 Building Termux Extensions Android app..."
echo ""

# Clean previous builds
echo "Cleaning previous builds..."
gradle clean

echo ""
echo "Building debug APK..."
gradle assembleDebug

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📦 APK location:"
    ls -lh app/build/outputs/apk/debug/app-debug.apk
    echo ""
    echo "To install:"
    echo "  adb install -r app/build/outputs/apk/debug/app-debug.apk"
    echo ""
    echo "Or copy to shared storage:"
    echo "  cp app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/"
else
    echo ""
    echo "❌ Build failed!"
    exit 1
fi
