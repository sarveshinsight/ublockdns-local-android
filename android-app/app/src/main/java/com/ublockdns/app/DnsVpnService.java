package com.ublockdns.app;

import android.content.Intent;
import android.net.VpnService;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

import mobile.Mobile;

public class DnsVpnService extends VpnService implements Runnable {
    private static final String TAG = "DnsVpnService";

    private Thread mThread;
    private ParcelFileDescriptor mInterface;

    // Static reference so MainActivity can directly call disconnect
    private static DnsVpnService sInstance;
    public static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        sInstance = this;
        isRunning = true;

        if (mThread != null) {
            mThread.interrupt();
        }
        mThread = new Thread(this, "DnsVpnThread");
        mThread.start();
        return START_STICKY;
    }

    /**
     * Called directly from MainActivity.stopVpn() via the static reference.
     * Tears down the VPN tunnel, stops the thread, and kills the service.
     */
    public void disconnect() {
        Log.i(TAG, "disconnect() called");
        isRunning = false;

        // 1. Close the TUN fd — this unblocks the blocking read() in run()
        closeInterface();

        // 2. Interrupt the worker thread
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }

        // 3. Stop the service from within
        stopSelf();
        sInstance = null;
    }

    /**
     * Static helper so MainActivity can trigger disconnect without needing
     * to send an intent through the Android service machinery.
     */
    public static void requestDisconnect() {
        Log.i(TAG, "requestDisconnect() called, sInstance=" + sInstance);
        isRunning = false;
        if (sInstance != null) {
            sInstance.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "onDestroy() called");
        isRunning = false;
        closeInterface();
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }
        sInstance = null;
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        // Called by Android when user revokes VPN from system settings
        Log.i(TAG, "onRevoke() called");
        disconnect();
    }

    @Override
    public void run() {
        try {
            configure();

            FileInputStream in = new FileInputStream(mInterface.getFileDescriptor());
            FileOutputStream out = new FileOutputStream(mInterface.getFileDescriptor());

            byte[] packet = new byte[32767];

            while (!Thread.currentThread().isInterrupted() && mInterface != null) {
                int length = in.read(packet);
                if (length > 0) {
                    byte[] requestBytes = new byte[length];
                    System.arraycopy(packet, 0, requestBytes, 0, length);

                    byte[] responseBytes = Mobile.processPacket(requestBytes);

                    if (responseBytes != null && responseBytes.length > 0) {
                        out.write(responseBytes);
                    }
                } else if (length < 0) {
                    // EOF — fd was closed, exit cleanly
                    break;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "VPN loop ended", e);
        } finally {
            closeInterface();
            isRunning = false;
        }
    }

    private void configure() {
        Builder builder = new Builder();
        builder.setSession("UblockDNS")
               .addAddress("10.0.0.2", 24)
               .addDnsServer("10.0.0.1")
               .addRoute("10.0.0.1", 32)
               .setBlocking(true);

        mInterface = builder.establish();
    }

    private void closeInterface() {
        if (mInterface != null) {
            try {
                mInterface.close();
            } catch (IOException e) {
                Log.e(TAG, "Failed to close interface", e);
            }
            mInterface = null;
        }
    }
}
