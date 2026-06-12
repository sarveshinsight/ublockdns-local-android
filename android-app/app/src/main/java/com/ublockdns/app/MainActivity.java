package com.ublockdns.app;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Constraints;
import androidx.work.NetworkType;

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

        webView.setWebViewClient(new WebViewClient());
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
            return DnsVpnService.isRunning;
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
                    Intent intent = new Intent(MainActivity.this, DnsVpnService.class);
                    stopService(intent);
                }
            });
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
        Mobile.stop();
        super.onDestroy();
    }
}
