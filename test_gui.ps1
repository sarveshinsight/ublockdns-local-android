Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "UblockDNS Toggle"
$form.Size = New-Object System.Drawing.Size(300,150)
$form.StartPosition = "CenterScreen"

$button = New-Object System.Windows.Forms.Button
$button.Location = New-Object System.Drawing.Point(50, 30)
$button.Size = New-Object System.Drawing.Size(180, 50)
$button.Text = "Enable UblockDNS"
$button.Font = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)

$enabled = $false

$button.Add_Click({
    if ($enabled) {
        # Disable it
        $button.Text = "Enable UblockDNS"
        $button.BackColor = [System.Drawing.Color]::LightGray
        $enabled = $false
        # Logic to revert DNS
    } else {
        # Enable it
        $button.Text = "Disable UblockDNS"
        $button.BackColor = [System.Drawing.Color]::LightGreen
        $enabled = $true
        # Logic to set DNS
    }
})

$form.Controls.Add($button)
$form.ShowDialog() | Out-Null
