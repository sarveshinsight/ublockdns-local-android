package com.ublockdns.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

import mobile.Mobile;

public class DnsVpnService extends VpnService {
    private static final String TAG = "DnsVpnService";

    private VpnWorker mWorker;
    private Thread mThread;
    private Handler mHandler;
    private Runnable mNotificationUpdater;

    // Static reference so MainActivity can directly call disconnect
    private static DnsVpnService sInstance;
    public static final AtomicBoolean isRunning = new AtomicBoolean(false);

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "onStartCommand called");
        if (intent != null && "ACTION_DISCONNECT".equals(intent.getAction())) {
            disconnect();
            return START_NOT_STICKY;
        }

        sInstance = this;
        isRunning.set(true);

        createNotificationChannel();
        
        updateNotification();

        if (mHandler == null) {
            mHandler = new Handler(Looper.getMainLooper());
            mNotificationUpdater = new Runnable() {
                @Override
                public void run() {
                    updateNotification();
                    if (isRunning.get()) {
                        mHandler.postDelayed(this, 5 * 60 * 1000);
                    }
                }
            };
            mHandler.postDelayed(mNotificationUpdater, 5 * 60 * 1000);
        }

        // Clean up any existing worker/thread completely before starting a new one
        stopActiveWorker();

        // Create and start a fresh worker
        mWorker = new VpnWorker();
        mThread = new Thread(mWorker, "DnsVpnThread");
        mThread.start();

        return START_STICKY;
    }

    private void updateNotification() {
        Intent activityIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, activityIntent, PendingIntent.FLAG_IMMUTABLE);
        
        Intent disconnectIntent = new Intent(this, DnsVpnService.class);
        disconnectIntent.setAction("ACTION_DISCONNECT");
        PendingIntent pDisconnectIntent = PendingIntent.getService(this, 0, disconnectIntent, PendingIntent.FLAG_IMMUTABLE);
        
        String notifText = Mobile.getNotificationText();

        Notification notification = new NotificationCompat.Builder(this, "VPN_CHANNEL_ID")
                .setContentTitle("UblockDNS Protection")
                .setContentText(notifText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(notifText))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Disconnect", pDisconnectIntent)
                .setOnlyAlertOnce(true)
                .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(1, notification);
        }
        startForeground(1, notification);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    "VPN_CHANNEL_ID",
                    "VPN Service Channel",
                    NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }

    private void stopActiveWorker() {
        if (mWorker != null) {
            mWorker.stop(); // This closes the FD, unblocking the thread
        }
        if (mThread != null) {
            mThread.interrupt();
            try {
                mThread.join(2000); // Wait for it to die cleanly
            } catch (InterruptedException e) {
                Log.w(TAG, "Interrupted while joining old thread");
            }
            mThread = null;
        }
        mWorker = null;
    }

    /**
     * Cleanly tears down the VPN tunnel.
     */
    public void disconnect() {
        Log.i(TAG, "disconnect() called");
        isRunning.set(false);

        if (mHandler != null && mNotificationUpdater != null) {
            mHandler.removeCallbacks(mNotificationUpdater);
            mHandler = null;
        }

        stopActiveWorker();

        stopSelf();
        sInstance = null;
    }

    /**
     * Static helper — callable from MainActivity without needing an intent.
     */
    public static void requestDisconnect() {
        Log.i(TAG, "requestDisconnect() called, sInstance=" + sInstance);
        isRunning.set(false);
        if (sInstance != null) {
            sInstance.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy() called");
        isRunning.set(false);
        stopActiveWorker();
        sInstance = null;
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        Log.i(TAG, "onRevoke() called");
        disconnect();
    }

    private class VpnWorker implements Runnable {
        private ParcelFileDescriptor mLocalInterface;
        private volatile boolean mStopping = false;

        public void stop() {
            mStopping = true;
            // Closing the FD is the ONLY way to unblock FileInputStream.read() in Android
            if (mLocalInterface != null) {
                try {
                    mLocalInterface.close();
                } catch (IOException e) {
                    Log.e(TAG, "Error closing local interface", e);
                }
            }
        }

        @Override
        public void run() {
            try {
                mLocalInterface = configure();
                if (mLocalInterface == null) {
                    Log.e(TAG, "Failed to establish VPN interface");
                    if (mWorker == this) isRunning.set(false);
                    return;
                }

                FileInputStream in = new FileInputStream(mLocalInterface.getFileDescriptor());
                FileOutputStream out = new FileOutputStream(mLocalInterface.getFileDescriptor());

                byte[] packet = new byte[2048];

                while (!Thread.currentThread().isInterrupted() && !mStopping) {
                    int length = in.read(packet);
                    if (length > 0) {
                        byte[] responseBytes = Mobile.processPacket(packet, length);

                        if (responseBytes != null && responseBytes.length > 0) {
                            out.write(responseBytes);
                        }
                    } else if (length < 0) {
                        // EOF
                        break;
                    }
                }
            } catch (Exception e) {
                if (!mStopping) {
                    Log.e(TAG, "VPN loop error", e);
                }
            } finally {
                stop();
                // Only update global state if this is still the active worker
                if (mWorker == this && !mStopping) {
                    isRunning.set(false);
                }
            }
        }

        private ParcelFileDescriptor configure() {
            try {
                Builder builder = new Builder();
                builder.setSession("UblockDNS")
                       .addAddress("10.0.0.2", 24)
                       .addDnsServer("10.0.0.1")
                       .addRoute("10.0.0.1", 32)
                       .setBlocking(true);

                return builder.establish();
            } catch (Exception e) {
                Log.e(TAG, "Failed to configure VPN", e);
                return null;
            }
        }
    }
}
