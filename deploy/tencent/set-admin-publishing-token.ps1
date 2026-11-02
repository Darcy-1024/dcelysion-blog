$ErrorActionPreference = 'Stop'
# Run interactively. Never pass the token as a command-line argument.
$publishingSecret = Read-Host 'GitHub fine-grained token (masked)' -AsSecureString
$publishingPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($publishingSecret)
try {
    $publishingPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($publishingPointer)
    if ($publishingPlain -notmatch '^github_pat_[A-Za-z0-9_]+$') { throw 'Expected a fine-grained GitHub token' }
    $publishingCode = "import sys,pathlib,os; p=pathlib.Path('/opt/dcelysion-admin-stage2/operator/github-publishing'); p.mkdir(parents=True,exist_ok=True,mode=0o700); t=sys.stdin.read().strip(); assert t.startswith('github_pat_') and len(t)>40; f=p/'token'; fd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600); os.write(fd,t.encode()); os.close(fd); f.chmod(0o600); print('Credential saved securely; token not displayed')"
    # Decimal bytes avoid nested double quotes, which Windows PowerShell 5
    # otherwise removes while passing native arguments to ssh.exe.
    $publishingBytes = [System.Text.Encoding]::UTF8.GetBytes($publishingCode) -join ','
    $publishingCommand = "sudo python3 -c 'exec(bytes([$publishingBytes]))'"
    $publishingPlain | ssh -4 -i C:/Users/Darcy/Downloads/Ubuntu.pem -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes ubuntu@124.220.196.115 $publishingCommand
    if ($LASTEXITCODE -ne 0) { throw 'Credential upload failed' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($publishingPointer)
    $publishingPlain = $null
    $publishingSecret.Dispose()
}
