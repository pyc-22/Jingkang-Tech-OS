param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\16\bin',
  [int]$PostgresPort = 55439,
  [string]$TemplateDatabase = 'massage_v89',
  [string]$Database = 'massage_p0_regression',
  [int]$ApiPort = 58080,
  [string]$JarPath = 'services\massage-api\target\massage-api-0.1.0.jar',
  [string]$JavaPath = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot\bin\java.exe',
  [switch]$KeepDatabase,
  [switch]$KeepApi
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fixture = Join-Path $PSScriptRoot 'p0-conflict-fixture.sql'
$psql = Join-Path $PostgresBin 'psql.exe'
$resolvedJar = if ([System.IO.Path]::IsPathRooted($JarPath)) { $JarPath } else { Join-Path $root $JarPath }
$apiLog = Join-Path $root '.runtime-logs\p0-conflict-api-regression.log'
$tenant = '11111111-1111-1111-1111-111111111111'
$store = '22222222-2222-2222-2222-222222222222'
$token = 'p0-admin-regression-token-20260911'
$headers = @{ Authorization = "Bearer $token"; 'X-Store-Id' = $store }
$jsonHeaders = @{ Authorization = "Bearer $token"; 'X-Store-Id' = $store; 'Content-Type' = 'application/json' }
$base = "http://127.0.0.1:$ApiPort"
$apiProcess = $null
$apiErrorLog = Join-Path $root '.runtime-logs\p0-conflict-api-regression.err.log'
$jdkSocketDir = 'C:\tmp\jdsock'
$savedEnvironment = @{}

Add-Type -AssemblyName System.Net.Http

function Invoke-Psql([string]$Db, [string]$Sql) {
  # Windows PowerShell 5 promotes native stderr (including PostgreSQL NOTICE) to a
  # terminating error when the script-wide ErrorActionPreference is Stop.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $psql -X -h 127.0.0.1 -p $PostgresPort -U postgres -d $Db -v ON_ERROR_STOP=1 -At -c $Sql 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $nativeOutput = @($output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
  if ($exitCode -ne 0) { throw "psql failed: $(($output | Out-String).Trim())" }
  return (($nativeOutput | Out-String).Trim())
}

function Read-WebExceptionResponse($Exception) {
  $webResponse = $Exception.Response
  if ($null -eq $webResponse) { throw $Exception }
  $body = ''
  $stream = $null
  $reader = $null
  try {
    $stream = $webResponse.GetResponseStream()
    if ($stream) {
      $reader = New-Object System.IO.StreamReader($stream)
      $body = $reader.ReadToEnd()
    }
  } finally {
    if ($reader) { $reader.Dispose() }
    elseif ($stream) { $stream.Dispose() }
  }
  $headers = @{}
  foreach ($key in $webResponse.Headers.AllKeys) { $headers[$key] = $webResponse.Headers[$key] }
  [pscustomobject]@{
    Status = [int]$webResponse.StatusCode
    Body = [string]$body
    Headers = $headers
  }
}

function Invoke-Http([string]$Method, [string]$Uri, [string]$Body = $null, [hashtable]$RequestHeaders = @{}) {
  $client = New-Object System.Net.Http.HttpClient
  $request = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($Method), $Uri)
  foreach ($key in $RequestHeaders.Keys) {
    [void]$request.Headers.TryAddWithoutValidation([string]$key, [string]$RequestHeaders[$key])
  }
  if (-not [string]::IsNullOrEmpty($Body)) {
    $request.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, 'application/json')
  }
  try {
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $headers = @{}
    foreach ($header in $response.Headers) { $headers[$header.Key] = ($header.Value -join ',') }
    foreach ($header in $response.Content.Headers) { $headers[$header.Key] = ($header.Value -join ',') }
    return [pscustomobject]@{
      Status = [int]$response.StatusCode
      Body = [string]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      Headers = $headers
    }
  } finally {
    $request.Dispose()
    $client.Dispose()
  }
}

function Invoke-Api([string]$Method, [string]$Path, [string]$Body = $null, [hashtable]$RequestHeaders = $jsonHeaders) {
  Invoke-Http $Method "$base$Path" $Body $RequestHeaders
}

function Assert-Status($Response, [int[]]$Expected, [string]$Label) {
  if ($Response.Status -notin $Expected) {
    throw "$Label returned HTTP $($Response.Status), expected $($Expected -join '/'). Body: $($Response.Body)"
  }
  Write-Host ("PASS {0}: HTTP {1}" -f $Label, $Response.Status)
}

function Assert-Sql([string]$Sql, [string]$Expected, [string]$Label) {
  $actual = Invoke-Psql $Database $Sql
  if ($actual -ne $Expected) { throw "$Label SQL assertion failed. Expected '$Expected', got '$actual'." }
  Write-Host ("PASS {0}: {1}" -f $Label, $actual)
}

function Start-ParallelRequest([string]$Name, [string]$Path, [string]$Body, [string]$OperationId, [datetime]$StartAt) {
  Start-Job -Name $Name -ScriptBlock {
    param($Base, $Path, $Body, $Store, $Token, $OperationId, $StartAt)
    $headers = @{
      Authorization = "Bearer $Token"
      'X-Store-Id' = $Store
      'Content-Type' = 'application/json'
    }
    if ($OperationId) { $headers['X-Offline-Operation-Id'] = $OperationId }
    while ([datetime]::UtcNow -lt $StartAt) { Start-Sleep -Milliseconds 10 }
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $request = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::Post, "$Base$Path")
    foreach ($key in $headers.Keys) {
      [void]$request.Headers.TryAddWithoutValidation([string]$key, [string]$headers[$key])
    }
    $request.Content = New-Object System.Net.Http.StringContent($Body, [System.Text.Encoding]::UTF8, 'application/json')
    try {
      $response = $client.SendAsync($request).GetAwaiter().GetResult()
      [pscustomobject]@{
        Name = $MyInvocation.MyCommand.Name
        Status = [int]$response.StatusCode
        Body = [string]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      }
    } finally {
      $request.Dispose()
      $client.Dispose()
    }
  } -ArgumentList $base, $Path, $Body, $store, $token, $OperationId, $StartAt
}

function Wait-ParallelRequests([System.Management.Automation.Job[]]$Jobs, [string]$Label) {
  $null = $Jobs | Wait-Job -Timeout 30
  $running = @($Jobs | Where-Object State -eq 'Running')
  if ($running.Count) { $running | Stop-Job; throw "$Label timed out" }
  $results = @($Jobs | Receive-Job)
  $Jobs | Remove-Job -Force
  Write-Host ("PASS {0}: HTTP statuses {1}" -f $Label, (($results.Status | Sort-Object) -join ','))
  return $results
}

try {
  if (-not (Test-Path -LiteralPath $psql)) { throw "psql.exe not found: $psql" }
  if (-not (Test-Path -LiteralPath $resolvedJar)) { throw "JAR not found: $resolvedJar" }
  if (-not (Test-Path -LiteralPath $JavaPath)) { throw "JDK 21 java.exe not found: $JavaPath" }
  if ($TemplateDatabase -notmatch '^[A-Za-z0-9_]+$' -or $Database -notmatch '^[A-Za-z0-9_]+$') {
    throw 'Database names may contain only letters, digits, and underscores'
  }
  if (Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $ApiPort is already in use"
  }

  Write-Host "Cloning $TemplateDatabase to $Database..."
  Invoke-Psql postgres "drop database if exists $Database with (force)" | Out-Null
  Invoke-Psql postgres "create database $Database template $TemplateDatabase" | Out-Null
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $psql -X -h 127.0.0.1 -p $PostgresPort -U postgres -d $Database -v ON_ERROR_STOP=1 -f $fixture 2>&1 | Out-Null
    $fixtureExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($fixtureExitCode -ne 0) { throw 'Fixture load failed' }

  foreach ($name in 'MASSAGE_DB_URL', 'MASSAGE_DB_USER', 'MASSAGE_DB_PASSWORD', 'MASSAGE_API_PORT', 'MASSAGE_API_ADDRESS', 'MASSAGE_EXPENSE_STORAGE_DIR') {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  $env:MASSAGE_DB_URL = "jdbc:postgresql://127.0.0.1:$PostgresPort/$Database"
  $env:MASSAGE_DB_USER = 'postgres'
  $env:MASSAGE_DB_PASSWORD = 'local-regression-only'
  $env:MASSAGE_API_PORT = "$ApiPort"
  $env:MASSAGE_API_ADDRESS = '127.0.0.1'
  $env:MASSAGE_EXPENSE_STORAGE_DIR = Join-Path $root '.runtime-logs\p0-expense-fixture'
  New-Item -ItemType Directory -Path (Split-Path $apiLog) -Force | Out-Null
  New-Item -ItemType Directory -Path $jdkSocketDir -Force | Out-Null
  foreach ($logPath in $apiLog, $apiErrorLog) {
    if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
  }
  $quotedJar = '"' + $resolvedJar + '"'
  $apiProcess = Start-Process -FilePath $JavaPath -ArgumentList @("-Djdk.net.unixdomain.tmpdir=$jdkSocketDir", '-jar', $quotedJar) -WorkingDirectory $root -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog -WindowStyle Hidden -PassThru

  $ready = $false
  foreach ($attempt in 1..60) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-Http GET "$base/api/health"
      if ($health.Status -eq 200) { $ready = $true; break }
    } catch {
      if ($attempt -eq 60) { Write-Host ("Health probe error: " + $_.Exception.Message) }
    }
    # Some Windows JDK launchers report the wrapper process as exited while the
    # child JVM is still binding the port. Keep probing for the full window;
    # the log and listener check below determine a genuine startup failure.
  }
  if (-not $ready) { throw "API did not become healthy on $base. See $apiLog" }
  Write-Host "API ready: $base"

  $change = Invoke-Api PUT '/api/v1/service-sessions/b0000000-0000-0000-0000-000000000001/extensions/b2000000-0000-0000-0000-000000000001/service-item' '{"reason":"2","serviceItemId":"51000000-0000-0000-0000-000000000002"}'
  Assert-Status $change @(200) 'same-minute extension item replacement'
  Assert-Sql "select service_item_id::text || '|' || planned_duration_minutes || '|' || service_price_cents from service_session_extension where id='b2000000-0000-0000-0000-000000000001'" '51000000-0000-0000-0000-000000000002|30|9900' 'extension snapshot changed'
  Assert-Sql "select count(*)::text from service_session_extension_change_log where extension_id='b2000000-0000-0000-0000-000000000001' and reason='2'" '1' 'extension change audit exists'
  Assert-Sql "select count(*)::text from service_session_duration_change_log where service_session_extension_id='b2000000-0000-0000-0000-000000000001' and added_duration_minutes=0" '0' 'zero-minute duration change absent'

  $mainChange = Invoke-Api PUT '/api/v1/service-sessions/b0000000-0000-0000-0000-000000000001/service-item' '{"reason":"2","serviceItemId":"51000000-0000-0000-0000-000000000001"}'
  Assert-Status $mainChange @(200) 'reported main service-item route on overdue active service'
  Assert-Sql "select service_item_id::text || '|' || planned_duration_minutes || '|' || service_price_cents from service_session where id='b0000000-0000-0000-0000-000000000001'" '51000000-0000-0000-0000-000000000001|60|8800' 'main service snapshot and total duration changed'
  Assert-Sql "select count(*)::text from service_session_item_change_log where service_session_id='b0000000-0000-0000-0000-000000000001' and reason='2'" '1' 'main service change audit exists'

  $extension = Invoke-Api POST '/api/v1/service-sessions/b0000000-0000-0000-0000-000000000001/extensions' '{"technicianId":"31000000-0000-0000-0000-000000000006","serviceItemId":"51000000-0000-0000-0000-000000000001"}'
  Assert-Status $extension @(200) 'add extension to active service'
  Assert-Sql "select count(*)::text from service_session_extension where service_session_id='b0000000-0000-0000-0000-000000000001'" '2' 'extension persisted'

  $queue = Invoke-Api POST '/api/v1/service-sessions/clock-in' '{"technicianId":"31000000-0000-0000-0000-000000000001","roomId":"41000000-0000-0000-0000-000000000001","bedId":"61000000-0000-0000-0000-000000000001","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"clockType":"QUEUE"}'
  Assert-Status $queue @(200) 'QUEUE clock-in'
  $call = Invoke-Api POST '/api/v1/service-sessions/clock-in' '{"technicianId":"31000000-0000-0000-0000-000000000002","roomId":"41000000-0000-0000-0000-000000000002","bedId":"61000000-0000-0000-0000-000000000002","serviceItemId":"50000000-0000-0000-0000-000000000002","plannedDurationMinutes":120,"clockType":"CALL"}'
  Assert-Status $call @(200) 'CALL clock-in'
  $selected = Invoke-Api POST '/api/v1/service-sessions/clock-in' '{"technicianId":"31000000-0000-0000-0000-000000000007","roomId":"41000000-0000-0000-0000-000000000010","bedId":"61000000-0000-0000-0000-000000000010","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"clockType":"SELECTED"}'
  Assert-Status $selected @(200) 'SELECTED clock-in'
  Assert-Sql "select count(*)::text from service_session where clock_type in ('QUEUE','CALL','SELECTED') and status='PENDING_ACCEPTANCE' and technician_id in ('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000007')" '3' 'immediate clock types persisted'

  $bookedQueue = Invoke-Api POST '/api/v1/service-reservations' '{"technicianId":"31000000-0000-0000-0000-000000000008","roomId":"41000000-0000-0000-0000-000000000011","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"reservationType":"BOOKED_QUEUE","note":"P0 booked queue"}'
  Assert-Status $bookedQueue @(200) 'BOOKED_QUEUE reservation'
  $bookedCall = Invoke-Api POST '/api/v1/service-reservations' '{"technicianId":"31000000-0000-0000-0000-000000000009","roomId":"41000000-0000-0000-0000-000000000012","serviceItemId":"50000000-0000-0000-0000-000000000002","plannedDurationMinutes":120,"reservationType":"BOOKED_CALL","note":"P0 booked call"}'
  Assert-Status $bookedCall @(200) 'BOOKED_CALL reservation'
  Assert-Sql "select count(*)::text from service_reservation where reservation_type in ('BOOKED_QUEUE','BOOKED_CALL') and status='WAITING' and technician_id in ('31000000-0000-0000-0000-000000000008','31000000-0000-0000-0000-000000000009')" '2' 'booked clock types persisted'

  $receiptWaitBody = '{"status":"CLEANING","reason":"P0 concurrent idempotent wait"}'
  $roomLockJob = Start-Job -ScriptBlock {
    param($Psql, $Port, $Database)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & $Psql -X -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -At -c "begin; select id from room where id='41000000-0000-0000-0000-000000000007' for update; select pg_sleep(3); commit;" 2>&1 | Out-Null
      $lockExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($lockExitCode -ne 0) { throw 'room lock fixture failed' }
  } -ArgumentList $psql, $PostgresPort, $Database
  try {
    Start-Sleep -Milliseconds 500
    $receiptWaitStart = [datetime]::UtcNow.AddMilliseconds(500)
    $receiptWait = Wait-ParallelRequests @(
      (Start-ParallelRequest 'same-operation-a' '/api/v1/rooms/41000000-0000-0000-0000-000000000007/status' $receiptWaitBody 'd0000000-0000-0000-0000-000000000010' $receiptWaitStart),
      (Start-ParallelRequest 'same-operation-b' '/api/v1/rooms/41000000-0000-0000-0000-000000000007/status' $receiptWaitBody 'd0000000-0000-0000-0000-000000000010' $receiptWaitStart)
    ) 'same operation waits for applied receipt'
  } finally {
    $null = $roomLockJob | Wait-Job -Timeout 10
    $roomLockJob | Receive-Job | Out-Null
    $roomLockJob | Remove-Job -Force
  }
  if ((@($receiptWait | Where-Object Status -eq 200)).Count -ne 1 -or (@($receiptWait | Where-Object Status -eq 204)).Count -ne 1) {
    throw "same operation expected one 200 and one replayed 204; got $($receiptWait.Status -join ',')"
  }
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000007' and reason='P0 concurrent idempotent wait'" '1' 'same operation wrote once'

  $sameTechBodyA = '{"technicianId":"31000000-0000-0000-0000-000000000003","roomId":"41000000-0000-0000-0000-000000000003","bedId":"61000000-0000-0000-0000-000000000003","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"clockType":"CALL"}'
  $sameTechBodyB = '{"technicianId":"31000000-0000-0000-0000-000000000003","roomId":"41000000-0000-0000-0000-000000000004","bedId":"61000000-0000-0000-0000-000000000004","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"clockType":"QUEUE"}'
  $sameTechStart = [datetime]::UtcNow.AddSeconds(2)
  $sameTech = Wait-ParallelRequests @(
    (Start-ParallelRequest 'same-tech-a' '/api/v1/service-sessions/clock-in' $sameTechBodyA 'd0000000-0000-0000-0000-000000000001' $sameTechStart),
    (Start-ParallelRequest 'same-tech-b' '/api/v1/service-sessions/clock-in' $sameTechBodyB 'd0000000-0000-0000-0000-000000000002' $sameTechStart)
  ) 'same technician concurrent clock-in completed deterministically'
  if ((@($sameTech | Where-Object Status -eq 200)).Count -ne 1 -or (@($sameTech | Where-Object Status -eq 409)).Count -ne 1) {
    throw "same technician race expected one 200 and one business 409; got $($sameTech.Status -join ',')"
  }
  Assert-Sql "select count(*)::text from service_session_participant where technician_id='31000000-0000-0000-0000-000000000003' and status in ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE')" '1' 'same-technician race kept one active assignment'

  $sameBedBodyA = '{"technicianId":"31000000-0000-0000-0000-000000000004","roomId":"41000000-0000-0000-0000-000000000005","bedId":"61000000-0000-0000-0000-000000000005","serviceItemId":"50000000-0000-0000-0000-000000000001","plannedDurationMinutes":90,"clockType":"QUEUE"}'
  $sameBedBodyB = '{"technicianId":"31000000-0000-0000-0000-000000000005","roomId":"41000000-0000-0000-0000-000000000005","bedId":"61000000-0000-0000-0000-000000000005","serviceItemId":"50000000-0000-0000-0000-000000000002","plannedDurationMinutes":120,"clockType":"CALL"}'
  $sameBedStart = [datetime]::UtcNow.AddSeconds(2)
  $sameBed = Wait-ParallelRequests @(
    (Start-ParallelRequest 'same-bed-a' '/api/v1/service-sessions/clock-in' $sameBedBodyA 'd0000000-0000-0000-0000-000000000003' $sameBedStart),
    (Start-ParallelRequest 'same-bed-b' '/api/v1/service-sessions/clock-in' $sameBedBodyB 'd0000000-0000-0000-0000-000000000004' $sameBedStart)
  ) 'same bed concurrent clock-in completed deterministically'
  if ((@($sameBed | Where-Object Status -eq 200)).Count -ne 1 -or (@($sameBed | Where-Object Status -eq 409)).Count -ne 1) {
    throw "same bed race expected one 200 and one business 409; got $($sameBed.Status -join ',')"
  }
  Assert-Sql "select count(*)::text from service_session where bed_id='61000000-0000-0000-0000-000000000005' and status in ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')" '1' 'same-bed race kept one occupant'

  $statusBody = '{"status":"CLEANING","reason":"P0 concurrent status"}'
  $statusStart = [datetime]::UtcNow.AddSeconds(2)
  $statusRace = Wait-ParallelRequests @(
    (Start-ParallelRequest 'status-a' '/api/v1/rooms/41000000-0000-0000-0000-000000000007/status' $statusBody 'd0000000-0000-0000-0000-000000000005' $statusStart),
    (Start-ParallelRequest 'status-b' '/api/v1/rooms/41000000-0000-0000-0000-000000000007/status' $statusBody 'd0000000-0000-0000-0000-000000000006' $statusStart)
  ) 'same room duplicate status update'
  if (@($statusRace | Where-Object Status -notin @(200, 204)).Count) {
    throw "room status race returned unexpected HTTP statuses: $($statusRace.Status -join ',')"
  }
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000007' and status='CLEANING' and reason='P0 concurrent status'" '1' 'duplicate status update stored once'

  $cleanFirst = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000008/complete-cleaning' $null $headers
  Assert-Status $cleanFirst @(200, 204) 'complete cleaning first call'
  $cleanReplay = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000008/complete-cleaning' $null $headers
  Assert-Status $cleanReplay @(200, 204) 'complete cleaning replay'
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000008' and status='IDLE' and reason='Cleaning completed'" '1' 'cleaning replay stored once'

  $cleanStart = [datetime]::UtcNow.AddSeconds(2)
  $cleanRace = Wait-ParallelRequests @(
    (Start-ParallelRequest 'clean-a' '/api/v1/rooms/41000000-0000-0000-0000-000000000009/complete-cleaning' '' 'd0000000-0000-0000-0000-000000000007' $cleanStart),
    (Start-ParallelRequest 'clean-b' '/api/v1/rooms/41000000-0000-0000-0000-000000000009/complete-cleaning' '' 'd0000000-0000-0000-0000-000000000008' $cleanStart)
  ) 'complete cleaning concurrent replay'
  if (@($cleanRace | Where-Object Status -notin @(200, 204)).Count) {
    throw "complete-cleaning race returned unexpected HTTP statuses: $($cleanRace.Status -join ',')"
  }
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000009' and status='IDLE' and reason='Cleaning completed'" '1' 'concurrent cleaning stored once'

  $badOperationHeaders = @{
    Authorization = "Bearer $token"
    'X-Store-Id' = $store
    'Content-Type' = 'application/json'
    'X-Offline-Operation-Id' = 'not-a-uuid'
  }
  $badOperation = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000007/status' '{"status":"IDLE","reason":"must not execute"}' $badOperationHeaders
  Assert-Status $badOperation @(400) 'malformed offline operation id'
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000007' and reason='must not execute'" '0' 'bad operation id caused no write'

  $replayOperationHeaders = @{
    Authorization = "Bearer $token"
    'X-Store-Id' = $store
    'Content-Type' = 'application/json'
    'X-Offline-Operation-Id' = 'd0000000-0000-0000-0000-000000000009'
  }
  $replayBody = '{"status":"MAINTENANCE","reason":"P0 applied replay"}'
  $replayFirst = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000008/status' $replayBody $replayOperationHeaders
  Assert-Status $replayFirst @(200, 204) 'offline operation first application'
  $replaySecond = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000008/status' $replayBody $replayOperationHeaders
  Assert-Status $replaySecond @(204) 'offline operation replay'
  if ([string]$replaySecond.Headers['X-Offline-Operation-Replayed'] -ne 'true') {
    throw 'offline operation replay response is missing X-Offline-Operation-Replayed: true'
  }
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000008' and reason='P0 applied replay'" '1' 'offline operation replay wrote once'
  Assert-Sql "select status || '|' || response_status from offline_operation_receipt where operation_id='d0000000-0000-0000-0000-000000000009'" 'APPLIED|200' 'offline operation receipt applied'

  $reusedOperation = Invoke-Api POST '/api/v1/rooms/41000000-0000-0000-0000-000000000009/status' '{"status":"MAINTENANCE","reason":"must not reuse id"}' $replayOperationHeaders
  Assert-Status $reusedOperation @(409) 'offline operation id reused for another path'
  Assert-Sql "select count(*)::text from room_status_event where room_id='41000000-0000-0000-0000-000000000009' and reason='must not reuse id'" '0' 'reused operation id caused no write'

  Start-Sleep -Milliseconds 500
  $combinedLog = ((Get-Content -LiteralPath $apiLog -Raw -ErrorAction SilentlyContinue) + "`n" +
    (Get-Content -LiteralPath $apiErrorLog -Raw -ErrorAction SilentlyContinue))
  foreach ($expectedLog in 'Clock-in rejected', 'Offline operation rejected', 'HTTP write rejected') {
    if (-not $combinedLog.Contains($expectedLog)) { throw "API WARN evidence is missing: $expectedLog" }
    Write-Host "PASS WARN log evidence: $expectedLog"
  }

  Write-Host 'P0 PostgreSQL/API regression passed.' -ForegroundColor Green
} finally {
  if ($apiProcess -and -not $KeepApi -and -not $apiProcess.HasExited) {
    Stop-Process -Id $apiProcess.Id -Force
    $apiProcess.WaitForExit()
  }
  if (-not $KeepApi) {
    try {
      $listener = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
      if ($listener) { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue }
    } catch {}
  }
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
  if (-not $KeepDatabase) {
    try { Invoke-Psql postgres "drop database if exists $Database with (force)" | Out-Null } catch { Write-Warning $_ }
  }
}
