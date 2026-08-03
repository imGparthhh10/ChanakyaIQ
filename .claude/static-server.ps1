param(
  [int]$Port = 8099,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Net.HttpListener -ErrorAction SilentlyContinue

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving '$Root' on http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html'; '.js' = 'text/javascript'; '.mjs' = 'text/javascript';
  '.css'  = 'text/css';  '.json' = 'application/json';
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  '.csv'  = 'text/csv';  '.svg' = 'image/svg+xml'; '.png' = 'image/png';
  '.ico'  = 'image/x-icon'; '.woff2' = 'font/woff2';
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $fullPath = Join-Path $Root ($path.TrimStart('/'))
    $fullPath = [System.IO.Path]::GetFullPath($fullPath)

    if (-not $fullPath.StartsWith([System.IO.Path]::GetFullPath($Root))) {
      $res.StatusCode = 403; $res.Close(); continue
    }

    if (Test-Path $fullPath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $res.ContentType = $ct
      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    $res.Close()
  }
}
