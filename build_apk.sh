#!/bin/bash
set -e

echo "=== 1. Building React Frontend (Isolated) ==="
# We copy ONLY the React source to /tmp to avoid Windows node_modules lock issues, without copying the whole 1GB Android project
mkdir -p /tmp/web
cp /app/web/package*.json /app/web/vite.config.js /app/web/index.html /tmp/web/ 2>/dev/null || true
cp -r /app/web/src /tmp/web/src
cp -r /app/web/public /tmp/web/public 2>/dev/null || true

cd /tmp/web
npm install
npm run build

echo "=== 2. Copying Frontend to Go Embedded Filesystem ==="
cd /app
rm -rf web_dist
cp -r /tmp/web/dist web_dist

echo "=== 3. Compiling Go Backend via Gomobile ==="
mkdir -p android-app/app/libs
gomobile bind -target=android -androidapi 24 -o android-app/app/libs/mobile.aar ./mobile

echo "=== 4. Building Android APK ==="
cd /app/android-app
yes | sdkmanager --licenses || true
gradle assembleDebug

echo "=== 5. Exporting APK ==="
mkdir -p /app/build_output
cp /app/android-app/app/build/outputs/apk/debug/app-debug.apk /app/build_output/ublockdns-debug.apk

echo "=== Build Complete! APK is located at D:\Gemini IDE\Ublockdns Android\build_output\ublockdns-debug.apk ==="
