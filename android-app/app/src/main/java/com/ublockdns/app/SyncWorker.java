package com.ublockdns.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import mobile.Mobile;

public class SyncWorker extends Worker {
    private static final String CHANNEL_ID = "update_channel";

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        // Ensure backend is initialized so SyncMaster works
        String dataDir = getApplicationContext().getFilesDir().getAbsolutePath();
        Mobile.start(dataDir);
        
        // Trigger the Gomobile blocklist sync
        Mobile.syncMaster();

        // Check for app updates
        checkForUpdates();

        return Result.success();
    }

    private void checkForUpdates() {
        try {
            URL url = new URL("https://api.github.com/repos/sarveshinsight/ublockdns-local-android/releases/latest");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/vnd.github+json");

            if (conn.getResponseCode() == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                JSONObject release = new JSONObject(response.toString());
                String latestVer = release.getString("tag_name").replace("v", "");
                String currentVer = "1.0"; // Should match build.gradle versionName

                if (isNewerVersion(currentVer, latestVer)) {
                    sendUpdateNotification(latestVer);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private boolean isNewerVersion(String current, String latest) {
        String[] cParts = current.split("\\.");
        String[] lParts = latest.split("\\.");
        int maxLen = Math.max(cParts.length, lParts.length);
        
        for (int i = 0; i < maxLen; i++) {
            int c = i < cParts.length ? Integer.parseInt(cParts[i]) : 0;
            int l = i < lParts.length ? Integer.parseInt(lParts[i]) : 0;
            if (l > c) return true;
            if (l < c) return false;
        }
        return false;
    }

    private void sendUpdateNotification(String version) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && 
            ContextCompat.checkSelfPermission(getApplicationContext(), android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return; // No permission to post notifications
        }

        NotificationManager notificationManager = (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "App Updates", NotificationManager.IMPORTANCE_DEFAULT);
            notificationManager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(getApplicationContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        PendingIntent pendingIntent = PendingIntent.getActivity(getApplicationContext(), 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setContentTitle("UblockDNS Update Available")
                .setContentText("Version " + version + " is available to download.")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);

        notificationManager.notify(2001, builder.build());
    }
}
