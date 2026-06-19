@echo off
echo Building Docker Image...
docker build -t ublockdns-builder .
if %ERRORLEVEL% NEQ 0 (
    echo Docker build failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Running Build Pipeline inside Docker...
docker run --rm -v "D:\Gemini IDE\Ublockdns Android":/app ublockdns-builder bash /app/build_apk.sh
if %ERRORLEVEL% NEQ 0 (
    echo Build Pipeline failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Success! Your APK is ready at D:\Gemini IDE\Ublockdns Android\build_output\ublockdns-debug.apk
