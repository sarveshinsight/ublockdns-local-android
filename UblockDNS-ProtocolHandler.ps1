param($url)

# Remove the ublockdns:// prefix and any trailing slashes
$action = $url -replace "^ublockdns://", ""
$action = $action -replace "/$", ""

# Require Administrator privileges
if (-Not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" `"$url`""
    exit
}

# The working directory when launched by protocol handler might be system32. 
# We need to switch to the script directory to run proxy.exe.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if ($action -eq "enable") {
    # 1. Start the proxy
    Stop-Process -Name "proxy" -ErrorAction SilentlyContinue
    if (-Not (Test-Path "proxy.exe")) {
        go build -o proxy.exe .\cmd\proxy\main.go
    }
    Start-Process -FilePath ".\proxy.exe" -WindowStyle Hidden
    
    # 2. Set DNS to 127.0.0.2 (and ::1 for IPv6 to prevent leaks)
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.Name -notmatch "vEthernet|Virtual|Loopback|Bluetooth" }
    foreach ($adapter in $adapters) {
        Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses ("127.0.0.2", "::1")
    }
    
    # Optional: Pop up a tiny confirmation balloon or message box
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("UblockDNS Enabled! System DNS is now routed through Docker.", "UblockDNS")
    
} elseif ($action -eq "disable") {
    # 1. Kill the proxy
    Stop-Process -Name "proxy" -ErrorAction SilentlyContinue
    
    # 2. Revert DNS
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.Name -notmatch "vEthernet|Virtual|Loopback|Bluetooth" }
    foreach ($adapter in $adapters) {
        Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses
    }
    Clear-DnsClientCache
    
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("UblockDNS Disabled! System DNS restored to automatic (DHCP).", "UblockDNS")
}
