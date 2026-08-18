$ErrorActionPreference = "Stop"
Import-Module Posh-SSH

$hostIp = $env:NAS_IP
$hostUser = $env:NAS_USER
$hostPass = $env:NAS_PASS

if (-not $hostIp -or -not $hostUser -or -not $hostPass) {
  Write-Error "Variables de entorno NAS_IP, NAS_USER y NAS_PASS son requeridas."
  exit 1
}

$localFile = "C:\Users\Angel\AppData\Local\Temp\opencode\CosmoToolbox.tar.zst"
$remoteDir = "/tmp"

$pass = ConvertTo-SecureString $hostPass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($hostUser, $pass)

Write-Output ("Local: {0:N1} MB" -f ((Get-Item $localFile).Length / 1MB))
$session = New-SFTPSession -ComputerName $hostIp -Credential $cred -AcceptKey -ConnectionTimeout 20 -ErrorAction Stop
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Set-SFTPItem -SessionId $session.SessionId -Path $localFile -Destination $remoteDir -Force
  $sw.Stop()
  $remoteSize = (Get-SFTPItem -SessionId $session.SessionId -Path "$remoteDir/CosmoToolbox.tar.zst").Length
  Write-Output ("Subido: {0:N1} MB en {1:N1} min ({2:N1} MB/min)" -f ($remoteSize / 1MB), $sw.Elapsed.TotalMinutes, (($remoteSize / 1MB) / $sw.Elapsed.TotalMinutes))
} finally {
  Remove-SFTPSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null
}
