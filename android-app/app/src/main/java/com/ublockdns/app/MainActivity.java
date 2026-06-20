package com.ublockdns.app;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Constraints;
import androidx.work.NetworkType;

import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import android.net.Uri;
import android.os.Environment;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

import mobile.Mobile;

public class MainActivity extends AppCompatActivity {
    private static final int VPN_REQUEST_CODE = 1001;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        
        // Hide ActionBar
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }

        // Request Notification Permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        // Initialize Go Backend
        String dataDir = getFilesDir().getAbsolutePath();
        Mobile.start(dataDir);
        
        // Setup WorkManager for Daily Syncs
        setupDailySync();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith("http://127.0.0.1")) {
                    return false;
                }
                return true; // Block anything else
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && url.startsWith("http://127.0.0.1")) {
                    return false;
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        // Setup JS Bridge
        webView.addJavascriptInterface(new WebAppInterface(), "Android");

        // Load the local dashboard
        webView.loadUrl("http://127.0.0.1:8080");
    }

    private void setupDailySync() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresCharging(true)
                .build();

        PeriodicWorkRequest syncRequest = new PeriodicWorkRequest.Builder(SyncWorker.class, 24, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(this).enqueue(syncRequest);
    }

    public class WebAppInterface {
        @JavascriptInterface
        public boolean isVpnRunning() {
            return DnsVpnService.isRunning.get();
        }

        @JavascriptInterface
        public void startVpn() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent intent = VpnService.prepare(MainActivity.this);
                    if (intent != null) {
                        startActivityForResult(intent, VPN_REQUEST_CODE);
                    } else {
                        onActivityResult(VPN_REQUEST_CODE, Activity.RESULT_OK, null);
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopVpn() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // Direct call — most reliable, no intent routing needed
                    DnsVpnService.requestDisconnect();
                    // Belt-and-suspenders: also tell Android to stop the service
                    Intent intent = new Intent(MainActivity.this, DnsVpnService.class);
                    stopService(intent);
                }
            });
        }

        @JavascriptInterface
        public String getAppVersion() {
            return "1.0"; // Should match build.gradle versionName
        }

        @JavascriptInterface
        public void downloadAndInstallUpdate(final String downloadUrl) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        URL url = new URL(downloadUrl);
                        HttpURLConnection c = (HttpURLConnection) url.openConnection();
                        c.setRequestMethod("GET");
                        c.connect();

                        String apkName = "ublockdns-update.apk";
                        File file = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), apkName);
                        FileOutputStream fos = new FileOutputStream(file);
                        InputStream is = c.getInputStream();

                        byte[] buffer = new byte[1024];
                        int len1 = 0;
                        while ((len1 = is.read(buffer)) != -1) {
                            fos.write(buffer, 0, len1);
                        }
                        fos.close();
                        is.close();

                        Intent intent = new Intent(Intent.ACTION_VIEW);
                        Uri apkUri = FileProvider.getUriForFile(MainActivity.this, getApplicationContext().getPackageName() + ".provider", file);
                        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(intent);

                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }).start();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == VPN_REQUEST_CODE && resultCode == Activity.RESULT_OK) {
            startService(new Intent(this, DnsVpnService.class));
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (!DnsVpnService.isRunning.get()) {
            Mobile.stop();
        }
        super.onDestroy();
    }
}
