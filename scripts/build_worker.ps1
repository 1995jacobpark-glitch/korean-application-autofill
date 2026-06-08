$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$WorkerScript = Join-Path $Root "scripts\hwp_worker.py"
$DistDir = Join-Path $Root "bin"
$WorkDir = Join-Path $Root ".work\pyinstaller"
$BuildSourceDir = if ($env:PUBLIC) {
    Join-Path $env:PUBLIC "Documents\HwpAutofillBuild"
} else {
    Join-Path $env:TEMP "HwpAutofillBuild"
}
$BuildWorkerScript = Join-Path $BuildSourceDir "hwp_worker.py"

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PythonPackage {
    param([string]$Name)

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & python -m pip show $Name *> $null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    return $exitCode -eq 0
}

if (-not (Test-CommandExists "python")) {
    throw "Python is required only on the build PC to create the bundled HWP worker exe."
}

Write-Host "Checking Python packages for worker build..."
if (-not (Test-PythonPackage "pywin32")) {
    Write-Host "Installing pywin32..."
    python -m pip install pywin32
}

if (-not (Test-PythonPackage "pyinstaller")) {
    Write-Host "Installing pyinstaller..."
    python -m pip install pyinstaller
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $BuildSourceDir | Out-Null
Copy-Item -LiteralPath $WorkerScript -Destination $BuildWorkerScript -Force

Write-Host "Building bundled HWP worker exe..."
python -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --console `
    --name hwp_worker `
    --distpath $DistDir `
    --workpath $WorkDir `
    --specpath $WorkDir `
    --hidden-import win32com `
    --hidden-import win32com.client `
    --hidden-import pythoncom `
    --hidden-import pywintypes `
    $BuildWorkerScript

$WorkerExe = Join-Path $DistDir "hwp_worker.exe"
if (-not (Test-Path $WorkerExe)) {
    throw "Worker exe was not created: $WorkerExe"
}

Write-Host "Worker ready: $WorkerExe"
