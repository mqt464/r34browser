Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$publicDir = Join-Path $projectDir 'public'
$sourcePath = Join-Path $projectDir 'bin\teto.png'

if (-not (Test-Path $sourcePath)) {
  throw "Source image not found at $sourcePath"
}

function New-Color {
  param(
    [string]$Hex,
    [int]$Alpha = 255
  )

  $cleanHex = $Hex.TrimStart('#')
  [System.Drawing.Color]::FromArgb(
    $Alpha,
    [Convert]::ToInt32($cleanHex.Substring(0, 2), 16),
    [Convert]::ToInt32($cleanHex.Substring(2, 2), 16),
    [Convert]::ToInt32($cleanHex.Substring(4, 2), 16)
  )
}

function New-RectF {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height
  )

  [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height)
}

function New-PointF {
  param(
    [float]$X,
    [float]$Y
  )

  [System.Drawing.PointF]::new($X, $Y)
}

function Get-SquareCrop {
  param([System.Drawing.Image]$Image)

  $edge = [Math]::Min($Image.Width, $Image.Height)
  $x = [int](($Image.Width - $edge) / 2)
  $y = [int](($Image.Height - $edge) / 2)

  [System.Drawing.Rectangle]::new($x, $y, $edge, $edge)
}

function Draw-BlurredBackground {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Source,
    [System.Drawing.Rectangle]$Crop,
    [int]$CanvasSize,
    [float]$PaddingFactor
  )

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $Graphics.Clear((New-Color '#180710'))

  $inset = $CanvasSize * $PaddingFactor
  $contentRect = New-RectF $inset $inset ($CanvasSize - ($inset * 2)) ($CanvasSize - ($inset * 2))

  $smallSize = [Math]::Max(48, [int]($CanvasSize * 0.18))
  $tiny = [System.Drawing.Bitmap]::new($smallSize, $smallSize)
  $tinyGraphics = [System.Drawing.Graphics]::FromImage($tiny)
  $tinyGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $tinyGraphics.DrawImage(
    $Source,
    [System.Drawing.Rectangle]::new(0, 0, $smallSize, $smallSize),
    $Crop,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $tinyGraphics.Dispose()

  $Graphics.DrawImage($tiny, $contentRect)
  $tiny.Dispose()

  $shadeBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    (New-PointF 0 0),
    (New-PointF 0 $CanvasSize),
    (New-Color '#2a0010' 18),
    (New-Color '#2a0010' 54)
  )
  $Graphics.FillRectangle($shadeBrush, 0, 0, $CanvasSize, $CanvasSize)
  $shadeBrush.Dispose()
}

function Draw-Label {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Size
  )

  $fontFamily = [System.Drawing.FontFamily]::new('Arial Black')
  $basePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $emSize = $Size * 0.33
  $basePath.AddString(
    'R34',
    $fontFamily,
    [int][System.Drawing.FontStyle]::Regular,
    $emSize,
    (New-PointF 0 0),
    [System.Drawing.StringFormat]::GenericDefault
  )

  $bounds = $basePath.GetBounds()
  $matrix = [System.Drawing.Drawing2D.Matrix]::new()
  $matrix.Translate(
    (($Size - $bounds.Width) / 2) - $bounds.X,
    (($Size * 0.70) - ($bounds.Height / 2)) - $bounds.Y
  )
  $basePath.Transform($matrix)

  $shadowPath = $basePath.Clone()
  $shadowMatrix = [System.Drawing.Drawing2D.Matrix]::new()
  $shadowMatrix.Translate($Size * 0.02, $Size * 0.02)
  $shadowPath.Transform($shadowMatrix)

  $shadowBrush = [System.Drawing.SolidBrush]::new((New-Color '#1d0220' 170))
  $Graphics.FillPath($shadowBrush, $shadowPath)
  $shadowBrush.Dispose()

  $outlinePen = [System.Drawing.Pen]::new((New-Color '#16311a' 220), [Math]::Max(3, $Size * 0.028))
  $outlinePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $Graphics.DrawPath($outlinePen, $basePath)
  $outlinePen.Dispose()

  $fillBrush = [System.Drawing.SolidBrush]::new((New-Color '#b8e2a8'))
  $Graphics.FillPath($fillBrush, $basePath)
  $fillBrush.Dispose()

  $glowPen = [System.Drawing.Pen]::new((New-Color '#eef8e8' 110), [Math]::Max(1, $Size * 0.009))
  $glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $Graphics.DrawPath($glowPen, $basePath)
  $glowPen.Dispose()

  $shadowPath.Dispose()
  $basePath.Dispose()
  $matrix.Dispose()
  $shadowMatrix.Dispose()
  $fontFamily.Dispose()
}

function Save-Icon {
  param(
    [string]$Path,
    [System.Drawing.Image]$Source,
    [System.Drawing.Rectangle]$Crop,
    [int]$Size,
    [float]$PaddingFactor
  )

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  Draw-BlurredBackground $graphics $Source $Crop $Size $PaddingFactor
  Draw-Label $graphics $Size

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
$crop = Get-SquareCrop $source

Save-Icon (Join-Path $publicDir 'favicon.png') $source $crop 32 0.00
Save-Icon (Join-Path $publicDir 'apple-touch-icon.png') $source $crop 180 0.00
Save-Icon (Join-Path $publicDir 'icon-192.png') $source $crop 192 0.00
Save-Icon (Join-Path $publicDir 'icon-512.png') $source $crop 512 0.00
Save-Icon (Join-Path $publicDir 'maskable-icon-512.png') $source $crop 512 0.12

$source.Dispose()
