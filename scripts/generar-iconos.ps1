# Genera los íconos PNG de la app en public/icons/.
# Uso: npm run icons
# Dibuja dos globos de diálogo (oyente y persona sorda) sobre fondo oscuro.
# Puedes reemplazar los PNG por un diseño propio cuando quieras.

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-Icon([int]$size, [string]$name, [double]$padding) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b0f14'))

    # Zona útil (los íconos "maskable" necesitan más margen)
    $p = $size * $padding
    $s = $size - 2 * $p

    $yellow = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#ffd60a'))
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

    # Globo amarillo (arriba a la izquierda)
    $g.FillEllipse($yellow, [float]($p), [float]($p + $s * 0.05), [float]($s * 0.62), [float]($s * 0.48))
    $tail1 = @(
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.12), [float]($p + $s * 0.40))),
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.05), [float]($p + $s * 0.62))),
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.30), [float]($p + $s * 0.48)))
    )
    $g.FillPolygon($yellow, $tail1)

    # Globo blanco (abajo a la derecha)
    $g.FillEllipse($white, [float]($p + $s * 0.38), [float]($p + $s * 0.45), [float]($s * 0.62), [float]($s * 0.48))
    $tail2 = @(
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.88), [float]($p + $s * 0.82))),
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.97), [float]($p + $s * 1.0))),
        (New-Object System.Drawing.PointF ([float]($p + $s * 0.70), [float]($p + $s * 0.90)))
    )
    $g.FillPolygon($white, $tail2)

    $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 'icon-192.png' 0.12
New-Icon 512 'icon-512.png' 0.12
New-Icon 512 'icon-maskable-512.png' 0.22
New-Icon 180 'apple-touch-icon.png' 0.14
Write-Host "Iconos generados en $outDir"
