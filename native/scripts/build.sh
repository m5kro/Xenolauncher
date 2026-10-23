#!/bin/bash
set -euo pipefail
NATIVE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$NATIVE_DIR/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-debug}"
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version)"
export CLANG_MODULE_CACHE_PATH="$NATIVE_DIR/.build/clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="$NATIVE_DIR/.build/manifest-cache"
NODE_EXECUTABLE="${NODE_BINARY:-$(command -v node || true)}"
if [ -z "$NODE_EXECUTABLE" ] || [ ! -x "$NODE_EXECUTABLE" ]; then
    echo 'Set NODE_BINARY to a Node.js 22+ executable, or install Node.js and add it to PATH.' >&2
    exit 1
fi
"$NODE_EXECUTABLE" -e 'if (+process.versions.node.split(".")[0] < 22) { console.error("Node.js 22+ is required"); process.exit(1) }'
mkdir -p "$NATIVE_DIR/Backend/upstream" "$NATIVE_DIR/dist"
cp "$PROJECT_DIR/app/module.js" "$NATIVE_DIR/Backend/upstream/module.js"
cp "$NODE_EXECUTABLE" "$NATIVE_DIR/Backend/node"
chmod +x "$NATIVE_DIR/Backend/node"
swift build --package-path "$NATIVE_DIR" --configuration "$CONFIGURATION" --disable-sandbox \
    --cache-path "$NATIVE_DIR/.build/cache" -Xcc "-fmodules-cache-path=$NATIVE_DIR/.build/clang-cache" \
    -Xlinker -platform_version -Xlinker macos -Xlinker 13.0 -Xlinker "$SDK_VERSION"
BIN_DIR="$(swift build --package-path "$NATIVE_DIR" --configuration "$CONFIGURATION" --show-bin-path --disable-sandbox --cache-path "$NATIVE_DIR/.build/cache")"
APP_DIR="$NATIVE_DIR/dist/Xenolauncher.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/Xenolauncher" "$APP_DIR/Contents/MacOS/Xenolauncher"
cp "$PROJECT_DIR/LICENSE" "$APP_DIR/Contents/Resources/LICENSE"
cp "$NATIVE_DIR/Resources/AppIcon.icns" "$APP_DIR/Contents/Resources/app.icns"
# Bundle.module resolves the SwiftPM resource bundle from the app's resources.
for RESOURCE_BUNDLE in "$BIN_DIR/"*.bundle; do
    if [ -d "$RESOURCE_BUNDLE" ]; then
        /usr/bin/ditto "$RESOURCE_BUNDLE" "$APP_DIR/Contents/Resources/$(basename "$RESOURCE_BUNDLE")"
    fi
done
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
    <key>CFBundleName</key><string>Xenolauncher</string>
    <key>CFBundleDisplayName</key><string>Xenolauncher</string>
    <key>CFBundleIdentifier</key><string>org.xenolauncher.native</string>
    <key>CFBundleExecutable</key><string>Xenolauncher</string>
    <key>CFBundleIconFile</key><string>app.icns</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
# This is a local development signature, not a Developer ID release signature.
while IFS= read -r RUNTIME_BINARY; do
    /usr/bin/codesign --force --sign - "$RUNTIME_BINARY"
done < <(/usr/bin/find "$APP_DIR/Contents/Resources" -type f -path '*/Backend/node')
/usr/bin/codesign --force --deep --sign - "$APP_DIR"
# Updating files inside an existing bundle does not change the bundle directory's
# modification time. Refresh its metadata so Finder drops a cached generic icon.
/usr/bin/touch "$APP_DIR"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
    if ! "$LSREGISTER" -f "$APP_DIR"; then
        echo 'Warning: Launch Services could not refresh this app. Reopen its folder in Finder to check the icon.' >&2
    fi
fi
echo "Built: $APP_DIR"
