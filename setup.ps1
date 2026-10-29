# Sets up HomeCoin's local Python environment (.venv) and installs the dependencies.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$python = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {  # Python installed elsewhere: py launcher or python on PATH, as long as it is 3.12 or 3.13
    foreach ($c in @(@('py', '-3.12'), @('py', '-3.13'), @('python'))) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
        $exe = & $c[0] @($c | Select-Object -Skip 1) -c "import sys; print(sys.executable if sys.version_info[:2] in ((3,12),(3,13)) else '')" 2>$null
        if ($exe -and (Test-Path $exe)) { $python = $exe; break }
    }
}
if (-not $python) {
    Write-Host 'Python not found: install it with  winget install Python.Python.3.12 --scope user' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path '.venv\Scripts\python.exe')) {
    & $python -m venv .venv
}
& .venv\Scripts\python.exe -m pip install --quiet --upgrade pip
& .venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
Write-Host 'Ready. Start HomeCoin with HomeCoin.cmd' -ForegroundColor Green
