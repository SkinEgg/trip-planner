# 產生 App 圖示（紅褐底、白色地圖釘＋星號）。用法：powershell -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [string]$path, [bool]$rounded, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 179, 67, 63))
  if ($rounded) {
    $r = [int]($size * 0.22); $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $r * 2, $r * 2, 180, 90); $p.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $p.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90); $p.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure(); $g.FillPath($bg, $p)
  } else { $g.FillRectangle($bg, 0, 0, $size, $size) }

  # 地圖釘：上方圓、下方尖
  $s = $size * $scale; $cx = $size / 2; $top = ($size - $s) / 2 + $s * 0.02
  $R = $s * 0.30; $cy = $top + $R
  $pin = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pin.AddArc([float]($cx - $R), [float]($cy - $R), [float]($R * 2), [float]($R * 2), 150, 240)
  $pin.AddLine([float]($cx + $R * [Math]::Cos([Math]::PI / 6)), [float]($cy + $R * 0.5), [float]$cx, [float]($top + $s * 0.92))
  $pin.CloseFigure()
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 250, 246, 238))
  $g.FillPath($white, $pin)

  # 中間的星號（必去）
  $pts = New-Object 'System.Drawing.PointF[]' 10; $ro = $R * 0.55; $ri = $ro * 0.45
  for ($i = 0; $i -lt 10; $i++) {
    $ang = -[Math]::PI / 2 + $i * [Math]::PI / 5; $rr = if ($i % 2 -eq 0) { $ro } else { $ri }
    $pts[$i] = New-Object System.Drawing.PointF ([float]($cx + $rr * [Math]::Cos($ang))), ([float]($cy + $rr * [Math]::Sin($ang)))
  }
  $g.FillPolygon($bg, $pts)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 (Join-Path $out "icon-192.png") $true 0.78
New-Icon 512 (Join-Path $out "icon-512.png") $true 0.78
New-Icon 512 (Join-Path $out "icon-maskable-512.png") $false 0.62
New-Icon 180 (Join-Path $out "apple-touch-icon.png") $false 0.70
Get-ChildItem $out | Select-Object Name, Length
