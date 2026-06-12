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
    private volatile boolean mStopping = false;

    // Static reference so MainActivity can directly call disconnect
    private static DnsVpnService sInstance;
    public static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "onStartCommand called");
        sInstance = this;
        mStopping = false;
        isRunning = true;

        // Kill any existing thread before starting fresh
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }

        // Close any lingering interface from a previous run
        closeInterface();

        mThread = new Thread(this, "DnsVpnThread");
        mThread.start();
        return START_STICKY;
    }

    /**
     * Cleanly tears down the VPN tunnel.
     * Can be called from any thread.
     */
    public void disconnect() {
        Log.i(TAG, "disconnect() called");
        mStopping = true;
        isRunning = false;

        // 1. Close the TUN fd — unblocks the blocking read()
        closeInterface();

        // 2. Interrupt the worker thread
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }

        // 3. Stop the service
        stopSelf();
        sInstance = null;
    }

    /**
     * Static helper — callable from MainActivity without needing an intent.
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
        mStopping = true;
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
        Log.i(TAG, "onRevoke() called");
        disconnect();
    }

    @Override
    public void run() {
        ParcelFileDescriptor localInterface = null;
        try {
            localInterface = configure();
            if (localInterface == null) {
                Log.e(TAG, "Failed to establish VPN interface");
                isRunning = false;
                return;
            }

            FileInputStream in = new FileInputStream(localInterface.getFileDescriptor());
            FileOutputStream out = new FileOutputStream(localInterface.getFileDescriptor());

            byte[] packet = new byte[32767];

            while (!Thread.currentThread().isInterrupted() && !mStopping) {
                int length = in.read(packet);
                if (length > 0) {
                    byte[] requestBytes = new byte[length];
                    System.arraycopy(packet, 0, requestBytes, 0, length);

                    byte[] responseBytes = Mobile.processPacket(requestBytes);

                    if (responseBytes != null && responseBytes.length > 0) {
                        out.write(responseBytes);
                    }
                } else if (length < 0) {
                    // EOF — fd was closed
                    break;
                }
            }
        } catch (Exception e) {
            if (!mStopping) {
                Log.e(TAG, "VPN loop error", e);
            }
        } finally {
            closeInterface();
            if (!mStopping) {
                // Unexpected exit — mark as not running
                isRunning = false;
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

            mInterface = builder.establish();
            return mInterface;
        } catch (Exception e) {
            Log.e(TAG, "Failed to configure VPN", e);
            return null;
        }
    }

    private void closeInterface() {
        ParcelFileDescriptor pfd = mInterface;
        mInterface = null;
        if (pfd != null) {
            try {
                pfd.close();
            } catch (IOException e) {
                Log.e(TAG, "Failed to close interface", e);
            }
        }
    }
}
