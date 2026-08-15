# DSH-vision: patch the dsh-host-apiproxy settings exposure allowlist so the
# "dsh-image-vision" settings namespace is served to the web settings page.
# This is the framework seam the apiproxy source comment points at
# (WEB_SETTINGS_NAMESPACES). Idempotent — safe to run repeatedly.
#
# Usage:  powershell -ExecutionPolicy Bypass -File patch-apiproxy.ps1
#         (or:  irm https://raw.githubusercontent.com/hisence999/DSH-vision/main/patch-apiproxy.ps1 | iex)
$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME }
           elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
           else { Join-Path $HOME '.dsh' }

$candidates = @(
    (Join-Path $dshHome 'profiles\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js'),
    (Join-Path $dshHome 'node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js')
)
try {
    $npmRoot = & npm root -g 2>$null
    if ($npmRoot) {
        $candidates += (Join-Path $npmRoot '@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js')
        $candidates += (Join-Path $npmRoot '@deepseek-ai\dsh-host-apiproxy\lib\index.js')
    }
} catch { }

$file = $null
foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) {
        $item = Get-Item -LiteralPath $c -Force
        $file = if ($item.LinkType) { Join-Path $item.Target 'lib\index.js' } else { $item.FullName }
        break
    }
}
if (-not $file) { Write-Error '未找到 dsh-host-apiproxy/lib/index.js，无法打补丁。' }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($file, $utf8)
if ($content -match '"dsh-image-vision"') {
    Write-Host "已打过补丁：$file"
    exit 0
}
$anchor = '"web-search-deepseek"'
if (-not $content.Contains($anchor)) { Write-Error '未找到白名单锚点，DSH 版本可能不兼容。' }

$insert = "`t$anchor,`r`n`t// dsh-image-vision: settings section for the DSH-vision plugin (added by DSH-vision installer)`r`n`t`"dsh-image-vision`""
[System.IO.File]::WriteAllText($file, $content.Replace($anchor, $insert), $utf8)
Write-Host "补丁完成：$file"
Write-Host '请重启 DSH 后，在「设置 → 图片理解」查看配置。'
