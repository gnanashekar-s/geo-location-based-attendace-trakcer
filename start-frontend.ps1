# start-frontend.ps1
# Tunnels the backend, writes mobile/.env.local, then launches Expo.
# Run from project root: .\start-frontend.ps1

$Root      = $PSScriptRoot
$MobileDir = Join-Path $Root "mobile"
$EnvLocal  = Join-Path $MobileDir ".env.local"

if (-not (Test-Path $MobileDir)) { Write-Error "mobile/ dir not found"; exit 1 }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Geo-Attendance  -  Frontend Launcher   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Detect local IP (fallback if tunnel fails) ────────────────────────
$LocalIP = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } |
    Select-Object -First 1).IPAddress

Write-Host "   Local IP detected: $LocalIP" -ForegroundColor DarkGray

# ── Step 2: Start localtunnel ─────────────────────────────────────────────────
Write-Host "[1/3] Starting localtunnel for backend (port 8000)..." -ForegroundColor Yellow

$TmpLog = Join-Path $env:TEMP ("lt_" + [System.Diagnostics.Process]::GetCurrentProcess().Id + ".txt")
if (Test-Path $TmpLog) { Remove-Item $TmpLog }

$LtJob = Start-Job -ScriptBlock {
    param($log)
    npx --yes localtunnel --port 8000 2>&1 | Tee-Object -FilePath $log
} -ArgumentList $TmpLog

$TunnelUrl = $null
$Deadline  = (Get-Date).AddSeconds(30)

Write-Host "   Waiting for tunnel URL" -NoNewline
while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Milliseconds 600
    Write-Host "." -NoNewline -ForegroundColor DarkGray
    if (Test-Path $TmpLog) {
        $Content = Get-Content $TmpLog -Raw -ErrorAction SilentlyContinue
        if ($Content -match 'your url is:\s*(https?://\S+)') {
            $TunnelUrl = $Matches[1].Trim()
            break
        }
    }
}
Write-Host ""

# ── Step 3: Write mobile/.env.local ───────────────────────────────────────────
Write-Host "[2/3] Writing mobile/.env.local..." -ForegroundColor Yellow

if ($TunnelUrl) {
    $ApiUrl = $TunnelUrl + "/api/v1"
    Write-Host "   Using tunnel: $ApiUrl" -ForegroundColor Green
} else {
    $ApiUrl = "http://" + $LocalIP + ":8000/api/v1"
    Write-Warning "Tunnel failed - falling back to local IP: $ApiUrl"
    Write-Warning "Phone must be on the same WiFi as this PC."
}

"EXPO_PUBLIC_API_URL=$ApiUrl" | Set-Content -Path $EnvLocal
Write-Host "   Wrote $EnvLocal" -ForegroundColor Green

# ── Step 4: Launch Expo in a new window ───────────────────────────────────────
Write-Host "[3/3] Launching Expo..." -ForegroundColor Yellow

$ExpoScript = Join-Path $env:TEMP ("expo_" + [System.Diagnostics.Process]::GetCurrentProcess().Id + ".ps1")

$s1 = 'Set-Location "' + $MobileDir + '"'
$s2 = 'Write-Host "  API -> ' + $ApiUrl + '" -ForegroundColor Green'
$s3 = 'Write-Host "  W=web  A=Android  Scan QR=phone" -ForegroundColor Cyan'
$s4 = 'npx expo start --tunnel'

($s1, $s2, $s3, $s4) -join "`n" | Set-Content -Path $ExpoScript

Start-Process powershell -ArgumentList "-NoExit", "-File", $ExpoScript

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "----------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Mobile API    : $ApiUrl" -ForegroundColor Cyan
Write-Host "  Web API       : http://localhost:8000/api/v1" -ForegroundColor Green
Write-Host "  MailHog       : http://localhost:8025" -ForegroundColor DarkGray
Write-Host "----------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Tunnel is alive in this window. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

try {
    Receive-Job $LtJob -Wait
} finally {
    Stop-Job  $LtJob -ErrorAction SilentlyContinue
    Remove-Job $LtJob -ErrorAction SilentlyContinue
    if (Test-Path $TmpLog)      { Remove-Item $TmpLog }
    if (Test-Path $ExpoScript)  { Remove-Item $ExpoScript }
}
