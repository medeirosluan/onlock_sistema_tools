$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $repoRoot "src-tauri\binaries"
$tmpZip = Join-Path $env:TEMP "platform-tools-latest-windows.zip"
$tmpDir = Join-Path $env:TEMP "platform-tools-windows"

Write-Host "Baixando platform-tools do Google..."
Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $tmpZip

if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Copy-Item -Force (Join-Path $tmpDir "platform-tools\adb.exe") (Join-Path $binDir "adb-x86_64-pc-windows-msvc.exe")
Copy-Item -Force (Join-Path $tmpDir "platform-tools\AdbWinApi.dll") $binDir
Copy-Item -Force (Join-Path $tmpDir "platform-tools\AdbWinUsbApi.dll") $binDir
Copy-Item -Force (Join-Path $tmpDir "platform-tools\fastboot.exe") (Join-Path $binDir "fastboot-x86_64-pc-windows-msvc.exe")

Write-Host "adb.exe instalado em $binDir"
