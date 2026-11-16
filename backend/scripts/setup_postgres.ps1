# Create the Raah PostgreSQL database on Windows. From the repository folder, in PowerShell:
#   powershell -ExecutionPolicy Bypass -File backend\scripts\setup_postgres.ps1
# Uses Docker Desktop if it is installed; otherwise installs PostgreSQL 16 with winget, then creates
# the role "raah" (password "raah") and the database "raah", and writes DATABASE_URL to backend\.env.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
$Url = "postgresql://raah:raah@localhost:5432/raah"
# password for the "postgres" admin account when this script installs PostgreSQL; change it if you like
$AdminPassword = "raah_admin"

$dockerUp = $false
if (Get-Command docker -ErrorAction SilentlyContinue) { docker info *> $null; $dockerUp = ($LASTEXITCODE -eq 0) }
if ($dockerUp) {
    docker compose up -d db
} else {
    $psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
    if (-not $psql) {
        Write-Host "Installing PostgreSQL 16 (takes a few minutes)..."
        winget install --id PostgreSQL.PostgreSQL.16 -e --accept-source-agreements --accept-package-agreements `
            --override "--mode unattended --unattendedmodeui none --superpassword $AdminPassword --serverport 5432"
        $psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" | Sort-Object FullName | Select-Object -Last 1
    } else {
        $entered = Read-Host "PostgreSQL is already installed. Password of its 'postgres' user (Enter for $AdminPassword)"
        if ($entered) { $AdminPassword = $entered }
    }
    $env:PGPASSWORD = $AdminPassword
    $hasRole = & $psql.FullName -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='raah'"
    if ($hasRole -ne "1") { & $psql.FullName -U postgres -h localhost -c "CREATE ROLE raah LOGIN PASSWORD 'raah'" }
    $hasDb = & $psql.FullName -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='raah'"
    if ($hasDb -ne "1") { & $psql.FullName -U postgres -h localhost -c "CREATE DATABASE raah OWNER raah" }
    Remove-Item Env:PGPASSWORD
}

if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
$lines = Get-Content backend\.env | Where-Object { $_ -notmatch '^DATABASE_URL=' }
$lines + "DATABASE_URL=$Url" | Set-Content backend\.env -Encoding utf8
Write-Host "PostgreSQL is ready: $Url"
