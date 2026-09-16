$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
  if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 21 first.' }
  $env:Path = "$env:JAVA_HOME/bin;$env:Path"
  & services/massage-api/mvnw.cmd -f services/massage-api/pom.xml -Pcoverage clean package
  if ($LASTEXITCODE -ne 0) { throw 'Backend tests or build failed.' }
  & services/massage-api/mvnw.cmd -f services/massage-api/pom.xml dependency:get '-Dartifact=org.jacoco:org.jacoco.cli:0.8.12:jar:nodeps'
  if ($LASTEXITCODE -ne 0) { throw 'Coverage CLI resolution failed.' }
  $cli = Join-Path $env:USERPROFILE '.m2/repository/org/jacoco/org.jacoco.cli/0.8.12/org.jacoco.cli-0.8.12-nodeps.jar'
  $env:REVIEW_COVERAGE = '1'
  node --test tools/regression/quality-review.test.js
  if ($LASTEXITCODE -ne 0) { throw 'HTTP regression failed.' }
  $output = Join-Path $root '.artifacts/quality-coverage'
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  & "$env:JAVA_HOME/bin/java.exe" -jar $cli merge services/massage-api/target/jacoco.exec .artifacts/quality-http.exec --destfile "$output/merged.exec"
  if ($LASTEXITCODE -ne 0) { throw 'Coverage merge failed.' }
  & "$env:JAVA_HOME/bin/java.exe" -jar $cli report "$output/merged.exec" --classfiles services/massage-api/target/classes --sourcefiles services/massage-api/src/main/java --html "$output/html" --csv "$output/report.csv" --xml "$output/report.xml"
  if ($LASTEXITCODE -ne 0) { throw 'Coverage report failed.' }
  $rows = Import-Csv "$output/report.csv"
  $covered = ($rows | Measure-Object LINE_COVERED -Sum).Sum
  $missed = ($rows | Measure-Object LINE_MISSED -Sum).Sum
  $percent = [Math]::Round(100 * $covered / ($covered + $missed), 2)
  [pscustomobject]@{ coveredLines=$covered; totalLines=($covered+$missed); linePercent=$percent; threshold=30 } | ConvertTo-Json | Tee-Object -FilePath "$output/summary.json"
  if ($percent -lt 30) { throw 'Combined backend line coverage is below 30 percent.' }
} finally {
  Remove-Item Env:REVIEW_COVERAGE -ErrorAction SilentlyContinue
  Pop-Location
}
