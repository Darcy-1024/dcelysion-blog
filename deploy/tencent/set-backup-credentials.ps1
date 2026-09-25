param(
    [string]$IdentityFile = 'C:/Users/Darcy/AppData/Local/Temp/dcelysion-ssh-0b4f390603ab4c6295e5d4d0c2ac8393/Ubuntu.pem',
    [string]$KnownHostsFile = 'C:/Users/Darcy/AppData/Local/Temp/dcelysion-ssh-0b4f390603ab4c6295e5d4d0c2ac8393/known_hosts',
    [string]$SshHost = 'ubuntu@124.220.196.115'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "SSH private key not found: $IdentityFile"
}
if (-not (Test-Path -LiteralPath $KnownHostsFile -PathType Leaf)) {
    throw "SSH known_hosts not found: $KnownHostsFile"
}

$accessSecure = $null
$secretSecure = $null
$accessPlain = $null
$secretPlain = $null
$json = $null
$accessBstr = [IntPtr]::Zero
$secretBstr = [IntPtr]::Zero

try {
    $accessSecure = Read-Host 'R2 Access Key ID' -AsSecureString
    $secretSecure = Read-Host 'R2 Secret Access Key' -AsSecureString

    $accessBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($accessSecure)
    $accessPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($accessBstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($accessBstr)
    $accessBstr = [IntPtr]::Zero

    $secretBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)
    $secretPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretBstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretBstr)
    $secretBstr = [IntPtr]::Zero

    if ($accessPlain -cnotmatch '^[a-f0-9]{32}$' -or $secretPlain -cnotmatch '^[a-f0-9]{64}$') {
        throw 'R2 credentials have an invalid format; nothing was sent.'
    }

    $json = @{ accessKeyId = $accessPlain; secretAccessKey = $secretPlain } | ConvertTo-Json -Compress
    $sshArgs = @(
        '-4', '-T',
        '-i', $IdentityFile,
        '-o', 'IdentitiesOnly=yes',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', "UserKnownHostsFile=$KnownHostsFile",
        $SshHost,
        'sudo -n python3 /opt/dcelysion/configure-backup-r2.py'
    )

    $json | & ssh @sshArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Remote credential setup failed (SSH exit code $LASTEXITCODE)."
    }
}
finally {
    if ($accessBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($accessBstr)
    }
    if ($secretBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretBstr)
    }
    $accessSecure = $null
    $secretSecure = $null
    $accessPlain = $null
    $secretPlain = $null
    $json = $null
}
