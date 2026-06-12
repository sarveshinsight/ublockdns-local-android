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
        mStopping = true; // Signal any old thread to stop
        isRunning = true;

        // Kill any existing thread and WAIT for it to die
        if (mThread != null) {
            mThread.interrupt();
            try {
                mThread.join(2000); // Wait up to 2 seconds for old thread to die
            } catch (InterruptedException e) {
                Log.w(TAG, "Interrupted while waiting for old thread");
            }
            mThread = null;
        }

        // Close any lingering interface from a previous run
        closeInterface();

        // Now safe to start fresh
        mStopping = false;
        mThread = new Thread(this, "DnsVpnThread");
        mThread.start();
        return START_STICKY;
    }

    /**
     * Cleanly tears down the VPN tunnel.
     */
    public void disconnect() {
        Log.i(TAG, "disconnect() called");
        mStopping = true;
        isRunning = false;

        closeInterface();

        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }

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
        // Capture our OWN local reference to the interface.
        // This way the finally block only closes THIS thread's interface,
        // never a new one created by a subsequent reconnect.
        ParcelFileDescriptor myInterface = null;
        try {
            myInterface = configure();
            if (myInterface == null) {
                Log.e(TAG, "Failed to establish VPN interface");
                isRunning = false;
                return;
            }

            FileInputStream in = new FileInputStream(myInterface.getFileDescriptor());
            FileOutputStream out = new FileOutputStream(myInterface.getFileDescriptor());

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
                    break;
                }
            }
        } catch (Exception e) {
            if (!mStopping) {
                Log.e(TAG, "VPN loop error", e);
            }
        } finally {
            // ONLY close OUR interface — never touch mInterface here.
            // disconnect() and onDestroy() handle closing mInterface.
            // This prevents the race where the old thread's finally block
            // closes a NEW interface created by a reconnect.
            if (myInterface != null) {
                try {
                    myInterface.close();
                } catch (IOException e) {
                    // Already closed by disconnect(), that's fine
                }
            }
            if (!mStopping) {
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
