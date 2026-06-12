package com.ublockdns.app;

import android.content.Intent;
import android.net.VpnService;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

import mobile.Mobile;

public class DnsVpnService extends VpnService {
    private static final String TAG = "DnsVpnService";

    private VpnWorker mWorker;
    private Thread mThread;

    // Static reference so MainActivity can directly call disconnect
    private static DnsVpnService sInstance;
    public static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "onStartCommand called");
        sInstance = this;
        isRunning = true;

        // Clean up any existing worker/thread completely before starting a new one
        stopActiveWorker();

        // Create and start a fresh worker
        mWorker = new VpnWorker();
        mThread = new Thread(mWorker, "DnsVpnThread");
        mThread.start();

        return START_STICKY;
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
        isRunning = false;

        stopActiveWorker();

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
                    if (mWorker == this) isRunning = false;
                    return;
                }

                FileInputStream in = new FileInputStream(mLocalInterface.getFileDescriptor());
                FileOutputStream out = new FileOutputStream(mLocalInterface.getFileDescriptor());

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
                    isRunning = false;
                }
            }
        }

        private ParcelFileDescriptor configure() {
            try {
                Builder builder = new Builder();
                builder.setSession("UblockDNS")
                       .addAddress("10.0.0.2", 24)
                       .addAddress("fd00:1:fd00:1:fd00:1:fd00:1", 64)
                       .addDnsServer("10.0.0.1")
                       .addDnsServer("fd00:1:fd00:1:fd00:1:fd00:2")
                       .addRoute("10.0.0.1", 32)
                       .addRoute("fd00:1:fd00:1:fd00:1:fd00:2", 128)
                       .setBlocking(true);

                return builder.establish();
            } catch (Exception e) {
                Log.e(TAG, "Failed to configure VPN", e);
                return null;
            }
        }
    }
}
