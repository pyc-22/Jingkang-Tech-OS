param(
  [Parameter(Mandatory = $true)][string]$DatabasePassword,
  [Parameter(Mandatory = $true)][string]$ExpenseStorageDir
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiJar = Join-Path $projectRoot 'services\massage-api\target\massage-api-0.1.0.jar'

if (-not [System.IO.Path]::IsPathRooted($ExpenseStorageDir)) {
  throw 'ExpenseStorageDir must be an absolute path outside the build directory.'
}
$expenseStorageDir = [System.IO.Path]::GetFullPath($ExpenseStorageDir)
New-Item -ItemType Directory -Path $expenseStorageDir -Force | Out-Null

if (-not $env:MASSAGE_DB_URL) { $env:MASSAGE_DB_URL = 'jdbc:postgresql://127.0.0.1:5432/massage_platform' }
if (-not $env:MASSAGE_DB_USER) { $env:MASSAGE_DB_USER = 'massage_app' }
if (-not $env:MASSAGE_DISPATCH_ACCEPTANCE_TIMEOUT_SECONDS) { $env:MASSAGE_DISPATCH_ACCEPTANCE_TIMEOUT_SECONDS = '300' }
$env:MASSAGE_DB_PASSWORD = $DatabasePassword
$env:MASSAGE_API_ADDRESS = '127.0.0.1'
$env:MASSAGE_API_PORT = '8080'
$env:MASSAGE_ADDRESS = '127.0.0.1'
$env:MASSAGE_PORT = '5174'
$env:MASSAGE_API_HOST = '127.0.0.1'
$env:MASSAGE_EXPENSE_STORAGE_DIR = $expenseStorageDir

if (-not (Test-Path -LiteralPath $apiJar -PathType Leaf)) {
  throw "API package not found: $apiJar"
}

Start-Process java -ArgumentList '-jar', $apiJar -WorkingDirectory $projectRoot -WindowStyle Hidden
Start-Process node -ArgumentList (Join-Path $projectRoot 'server.massage.js') -WorkingDirectory $projectRoot -WindowStyle Hidden

Write-Host 'API: http://127.0.0.1:8080/api/health'
Write-Host 'Web: http://127.0.0.1:5174/index.html'
Write-Host "Expense attachments: $expenseStorageDir"
