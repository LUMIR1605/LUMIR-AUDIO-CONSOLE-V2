param(
  [ValidateRange(1024, 65535)]
  [int]$ConsolePort = 4174
)

$ErrorActionPreference = "Stop"

$ttsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$consoleRoot = Split-Path -Parent $ttsRoot
$python = Join-Path $ttsRoot ".venv\Scripts\python.exe"
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $python)) {
  throw "LUMIR Local XTTS environment is missing. Run the isolated setup first."
}

function Test-LocalTts {
  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $client.Connect("127.0.0.1", 8788)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) { $client.Dispose() }
  }
}

$ttsOnline = Test-LocalTts

if (-not $ttsOnline) {
  Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8788" -WorkingDirectory $ttsRoot -WindowStyle Hidden | Out-Null
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 500
    if (Test-LocalTts) { $ttsOnline = $true; break }
  }
  if (-not $ttsOnline) {
    throw "LUMIR Local XTTS did not start on 127.0.0.1:8788."
  }
}

$env:PORT = [string]$ConsolePort
Push-Location -LiteralPath $consoleRoot
try {
  Write-Host "LUMIR Local TTS V1: http://127.0.0.1:$ConsolePort"
  & $node "server.mjs"
} finally {
  Pop-Location
}
