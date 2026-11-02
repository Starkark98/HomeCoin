# Sets up HomeCoin's local Python environment (.venv) and installs the dependencies.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$python = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {  # Python installed elsewhere: py launcher or python on PATH, as long as it is 3.12, 3.13 or 3.14
    foreach ($c in @(@('py', '-3.12'), @('py', '-3.13'), @('py', '-3.14'), @('python'))) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
        $exe = & $c[0] @($c | Select-Object -Skip 1) -c "import sys; print(sys.executable if sys.version_info[:2] in ((3,12),(3,13),(3,14)) else '')" 2>$null
        # not the Microsoft Store Python: it redirects %LOCALAPPDATA% (where the data lives) into its own package folder,
        # which is deleted when that Python is uninstalled
        if ($exe -and (Test-Path $exe) -and $exe -notlike '*\WindowsApps\*') { $python = $exe; break }
    }
}
if (-not $python) {
    Write-Host 'Python 3.12/3.13/3.14 from python.org not found (the Microsoft Store version is not supported): install it with  winget install Python.Python.3.12 --scope user' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path '.venv\Scripts\python.exe')) {
    & $python -m venv .venv
}
# exact versions with their SHA-256 (requirements.lock): pip refuses any file that does not match, and only ready-made
# wheels are used (no code is built or run during the installation). The pip bundled with Python is enough.
if (Test-Path 'requirements.lock') {
    & .venv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check --require-hashes --only-binary=:all: -r requirements.lock
} else {
    & .venv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check -r requirements.txt
}
if ($LASTEXITCODE) { Write-Host 'Installation of the dependencies failed (see the messages above)' -ForegroundColor Red; exit 1 }
Write-Host 'Ready. Start HomeCoin with HomeCoin.cmd' -ForegroundColor Green
