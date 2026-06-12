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
    public static final String ACTION_DISCONNECT = "com.ublockdns.app.DISCONNECT";

    private Thread mThread;
    private ParcelFileDescriptor mInterface;
    public static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Handle disconnect intent
        if (intent != null && ACTION_DISCONNECT.equals(intent.getAction())) {
            disconnect();
            return START_NOT_STICKY;
        }

        // Normal start - set up VPN
        isRunning = true;
        if (mThread != null) {
            mThread.interrupt();
        }
        mThread = new Thread(this, "DnsVpnThread");
        mThread.start();
        return START_STICKY;
    }

    /**
     * Cleanly tears down the VPN tunnel, stops the thread, and kills the service.
     */
    private void disconnect() {
        isRunning = false;

        // 1. Close the TUN file descriptor first - this unblocks the blocking read()
        closeInterface();

        // 2. Interrupt the worker thread
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }

        // 3. Stop the service from within itself - this is the reliable way
        stopSelf();
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        closeInterface();
        if (mThread != null) {
            mThread.interrupt();
            mThread = null;
        }
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        // Called by Android when the user revokes VPN permission from system settings
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
                    // EOF - file descriptor was closed, exit the loop
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
