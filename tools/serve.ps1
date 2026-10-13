# 本機測試用的小網頁伺服器（不需要安裝任何東西）。
# 用法：powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8765]
# 然後用瀏覽器開 http://localhost:8765/  （按 Ctrl+C 結束）
param([int]$Port = 8765)
$root = Split-Path -Parent $PSScriptRoot
$types = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"; ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png" = "image/png"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon"; ".sql" = "text/plain; charset=utf-8"; ".md" = "text/plain; charset=utf-8"
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq "") { $rel = "index.html" }
      $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($path.StartsWith($root) -and (Test-Path $path -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($path)
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
        $res.Headers.Add("Cache-Control", "no-cache")
        $res.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne "HEAD") { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $res.StatusCode = 404
      }
    } catch {
      Write-Host "request error: $($_.Exception.Message)"
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally { $listener.Stop() }
