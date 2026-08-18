param(
  [Parameter(Mandatory = $true)]
  [string]$RemoteCommand
)

$ErrorActionPreference = "Stop"
Import-Module Posh-SSH

$hostIp = $env:NAS_IP
$hostUser = $env:NAS_USER
$hostPass = $env:NAS_PASS

if (-not $hostIp -or -not $hostUser -or -not $hostPass) {
  Write-Error "Variables de entorno NAS_IP, NAS_USER y NAS_PASS son requeridas."
  exit 1
}

$pass = ConvertTo-SecureString $hostPass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($hostUser, $pass)
$session = New-SSHSession -ComputerName $hostIp -Credential $cred -AcceptKey -ConnectionTimeout 20 -ErrorAction Stop
try {
  $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $RemoteCommand
  $result.Output
  if ($result.ExitStatus -ne 0) {
    Write-Output ("EXIT_NONZERO: " + $result.ExitStatus)
  }
  $result.Error
} finally {
  Remove-SSHSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null
}
