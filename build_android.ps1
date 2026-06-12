Write-Host "Building Android Docker Image..."
docker build -t ublockdns-android-builder -f Dockerfile.android .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Running compilation inside Docker..."
# Mount current directory into /workspace to retrieve the APK
docker rm -f ublockdns-android-compiler
docker run --name ublockdns-android-compiler -v "${PWD}:/workspace" ublockdns-android-builder

if ($LASTEXITCODE -ne 0) {
    Write-Host "Android APK build failed!" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Done! Your Android APK is located in the current directory as ublockdns-android.apk" -ForegroundColor Green
