# ESDS BOIP — Zero-dependency static file server.
#
# PowerShell 5.1 ships with System.Net.HttpListener — no Node/Python needed.
# Right-click this file in File Explorer → "Run with PowerShell", or from
# a terminal:  powershell -ExecutionPolicy Bypass -File serve.ps1
#
# The dashboard opens automatically at http://localhost:8080/

$ErrorActionPreference = 'Stop'

# System.Web isn't loaded by default in Windows PowerShell 5.1 — pull it in
# so we get HttpUtility.UrlDecode for path decoding.
Add-Type -AssemblyName System.Web

# ── Config ───────────────────────────────────────
# The server will try each port in order until one binds. This handles
# Windows HTTP.SYS "stuck reservation" scenarios where a prior server
# left the port queued in the kernel.
$portCandidates = 8080, 8081, 8082, 8090, 8181, 9000
$hostname       = 'localhost'
$rootPath       = $PSScriptRoot
$openBrowser    = $true

# ── MIME map ─────────────────────────────────────
$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  '.xlsm' = 'application/vnd.ms-excel.sheet.macroEnabled.12'
  '.csv'  = 'text/csv; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
}

function Get-MimeType([string]$path) {
  $ext = [System.IO.Path]::GetExtension($path).ToLower()
  if ($mime.ContainsKey($ext)) { return $mime[$ext] }
  return 'application/octet-stream'
}

# ── Start listener — try each candidate port in order ────
$listener  = $null
$port      = $null
$prefix    = $null
$lastError = ''

foreach ($p in $portCandidates) {
    $tryListener = New-Object System.Net.HttpListener
    $tryPrefix   = "http://$hostname`:$p/"
    $tryListener.Prefixes.Add($tryPrefix)
    $ok = $true
    try {
        $tryListener.Start()
    } catch {
        $ok = $false
        $lastError = $_.Exception.Message
        Write-Host " Port $p unavailable - trying next..." -ForegroundColor DarkYellow
    }
    if ($ok) {
        $listener = $tryListener
        $port     = $p
        $prefix   = $tryPrefix
        break
    }
}

if ($null -eq $listener) {
    Write-Host ""
    Write-Host " Could not bind to any candidate port: $($portCandidates -join ', ')" -ForegroundColor Red
    Write-Host " Last error: $lastError" -ForegroundColor Red
    Write-Host ""
    Write-Host " Fix: reboot Windows to clear HTTP.SYS reservations, or run as Admin:" -ForegroundColor Yellow
    Write-Host "   net stop http /y ; net start http" -ForegroundColor Yellow
    Write-Host ""
    Read-Host " Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host " ======================================================" -ForegroundColor Cyan
Write-Host "   ESDS BOIP - local server" -ForegroundColor Cyan
Write-Host " ------------------------------------------------------" -ForegroundColor Cyan
Write-Host "   URL:     $prefix" -ForegroundColor White
Write-Host "   Serving: $rootPath" -ForegroundColor White
Write-Host ""
Write-Host "   Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host " ======================================================" -ForegroundColor Cyan
Write-Host ""

# Auto-open the browser (best effort)
if ($openBrowser) {
  try { Start-Process $prefix } catch { }
}

# ── Serve loop ───────────────────────────────────
try {
  while ($listener.IsListening) {
    $context  = $listener.GetContext()
    $request  = $context.Request
    $response = $context.Response

    $urlPath = [System.Web.HttpUtility]::UrlDecode($request.Url.AbsolutePath)
    if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/index.html' }

    # Prevent path traversal
    $safeRel = $urlPath.TrimStart('/','\').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootPath $safeRel))
    $rootFull = [System.IO.Path]::GetFullPath($rootPath)

    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $response.StatusCode = 403
      $response.Close()
      Write-Host "  403 " -NoNewline -ForegroundColor Red
      Write-Host $urlPath
      continue
    }

    if (-not (Test-Path $full -PathType Leaf)) {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 · $urlPath not found")
      $response.OutputStream.Write($msg, 0, $msg.Length)
      $response.Close()
      Write-Host "  404 " -NoNewline -ForegroundColor Red
      Write-Host $urlPath
      continue
    }

    try {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $response.ContentType = Get-MimeType $full
      $response.ContentLength64 = $bytes.Length
      # Long cache for hashed asset bundles could go here; keep simple for now
      $response.Headers.Add('Cache-Control', 'no-cache')
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.StatusCode = 200
      Write-Host "  200 " -NoNewline -ForegroundColor Green
      Write-Host $urlPath -NoNewline
      Write-Host "  ($($bytes.Length) bytes)" -ForegroundColor DarkGray
    } catch {
      $response.StatusCode = 500
      $errMsg = [System.Text.Encoding]::UTF8.GetBytes("500 · $($_.Exception.Message)")
      $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
      Write-Host "  500 " -NoNewline -ForegroundColor Red
      Write-Host $urlPath
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
  Write-Host ""
  Write-Host " Server stopped." -ForegroundColor Yellow
}
