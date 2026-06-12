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
    public static volatile boolean isRunning = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;
        if (mThread != null) {
            mThread.interrupt();
        }
        mThread = new Thread(this, "DnsVpnThread");
        mThread.start();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        closeInterface(); // Close first to unblock the I/O read() loop
        if (mThread != null) {
            mThread.interrupt();
        }
        super.onDestroy();
    }

    @Override
    public void run() {
        try {
            configure();
            
            FileInputStream in = new FileInputStream(mInterface.getFileDescriptor());
            FileOutputStream out = new FileOutputStream(mInterface.getFileDescriptor());
            
            byte[] packet = new byte[32767];
            
            while (!Thread.currentThread().isInterrupted()) {
                int length = in.read(packet);
                if (length > 0) {
                    byte[] requestBytes = new byte[length];
                    System.arraycopy(packet, 0, requestBytes, 0, length);
                    
                    // Pass the raw IP packet to Go
                    byte[] responseBytes = Mobile.processPacket(requestBytes);
                    
                    // If Go processed it and returned a response IP packet, write it back to the TUN interface
                    if (responseBytes != null && responseBytes.length > 0) {
                        out.write(responseBytes);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "VPN loop failed", e);
        } finally {
            closeInterface();
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
