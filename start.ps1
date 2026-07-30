[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$ProjectRoot = $PSScriptRoot
$FrontendDir = Join-Path $ProjectRoot "FrontEnd"
$BackendDir = Join-Path $ProjectRoot "BackEnd"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$FrontendHost = if ($env:FRONTEND_HOST) { $env:FRONTEND_HOST } else { "127.0.0.1" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }
$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$DemoScenario = Join-Path $BackendDir "experiments\test_scenario\trajectory.xml"
$DemoEvents = Join-Path $BackendDir "experiments\test_scenario\events.json"
$DemoModel = Join-Path $BackendDir "experiments\test_ppo\model.zip"
$Services = @()

function Find-CommandPath {
    param([string[]]$Names)
    foreach ($Name in $Names) {
        $Command = Get-Command $Name -ErrorAction SilentlyContinue
        if ($Command) { return $Command.Source }
    }
    return $null
}

function Stop-ServiceTree {
    param([System.Diagnostics.Process]$Process)
    if (-not $Process -or $Process.HasExited) { return }
    & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
}

$Npm = Find-CommandPath @("npm.cmd", "npm")
if (-not $Npm) {
    throw "npm was not found. Install Node.js 22 LTS, reopen the terminal, and run this script again."
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    if ($SkipInstall) {
        throw "FrontEnd\node_modules is missing, but -SkipInstall was specified."
    }
    Write-Host "First run: installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        & $Npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}

if (-not (Test-Path $BackendPython)) {
    if ($SkipInstall) {
        throw "BackEnd\.venv is missing, but -SkipInstall was specified."
    }

    $PyLauncher = Find-CommandPath @("py.exe", "py")
    $Python = Find-CommandPath @("python.exe", "python")
    if (-not $PyLauncher -and -not $Python) {
        throw "Python was not found. Install 64-bit Python 3.11 or 3.12 and enable 'Add Python to PATH'."
    }

    Write-Host "First run: creating the backend virtual environment..." -ForegroundColor Cyan
    if ($PyLauncher) {
        & $PyLauncher -3 -m venv (Join-Path $BackendDir ".venv")
    }
    else {
        & $Python -m venv (Join-Path $BackendDir ".venv")
    }
    if ($LASTEXITCODE -ne 0) { throw "Unable to create BackEnd\.venv." }

    Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
    & $BackendPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed with exit code $LASTEXITCODE." }
    & $BackendPython -m pip install -e $BackendDir
    if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path $DemoScenario) -or -not (Test-Path $DemoEvents) -or -not (Test-Path $DemoModel)) {
    Write-Warning "The local smoke scenario or PPO model is not present. The services will still start."
    Write-Host "Generate optional smoke assets in another terminal with:" -ForegroundColor Yellow
    Write-Host "  BackEnd\.venv\Scripts\python.exe BackEnd\scripts\generate_highway_scenario.py --output experiments/test_scenario"
    Write-Host "  BackEnd\.venv\Scripts\python.exe BackEnd\src\training\train_ppo.py --config configs/training_config.yaml --episodes 10 --output experiments/test_ppo"
}

try {
    Write-Host "Starting backend: http://${BackendHost}:${BackendPort}" -ForegroundColor Green
    $BackendProcess = Start-Process -FilePath $BackendPython -WorkingDirectory $BackendDir `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", $BackendHost, "--port", $BackendPort) `
        -NoNewWindow -PassThru
    $Services += $BackendProcess

    Write-Host "Starting frontend: http://${FrontendHost}:${FrontendPort}" -ForegroundColor Green
    $FrontendProcess = Start-Process -FilePath $Npm -WorkingDirectory $FrontendDir `
        -ArgumentList @("run", "dev", "--", "--host", $FrontendHost, "--port", $FrontendPort) `
        -NoNewWindow -PassThru
    $Services += $FrontendProcess

    Write-Host "Both services are running. Open http://${FrontendHost}:${FrontendPort}" -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop the frontend and backend." -ForegroundColor DarkGray

    while ($true) {
        foreach ($Service in $Services) {
            if ($Service.HasExited) {
                throw "A service stopped unexpectedly with exit code $($Service.ExitCode)."
            }
        }
        Start-Sleep -Milliseconds 700
    }
}
finally {
    Write-Host "Stopping project services..." -ForegroundColor DarkGray
    foreach ($Service in $Services) { Stop-ServiceTree $Service }
}
