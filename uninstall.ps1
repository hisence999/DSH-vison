# DSH Vision 卸载脚本（Windows PowerShell）
# 用法（一行命令）：
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1
#   （或：irm https://raw.githubusercontent.com/hisence999/DSH-vison/main/uninstall.ps1 | iex）
#
# 卸载内容：
#   1) 删除 $DSH_HOME/profiles/node_modules/dsh-image-vision/（插件包）
#   2) 从每个 profiles/<name>/cordis.patch.yml 移除 image-vision 插入行
#   3) 还原 apiproxy 白名单补丁（移除 dsh-image-vision）
#   4) settings.yaml 里的 dsh-image-vision 配置默认保留（重装后自动恢复）；
#      如需一并删除，加 -PurgeConfig 参数
# 卸载后需要重启 DSH。
param([switch]$PurgeConfig)
$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME }
           elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
           else { Join-Path $HOME '.dsh' }

function Find-ApiProxyFile {
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
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) {
            $item = Get-Item -LiteralPath $c -Force
            if ($item.LinkType) { return (Join-Path $item.Target 'lib\index.js') }
            return $item.FullName
        }
    }
    return $null
}

# ---------- 1) 删除插件包 ----------
$pkgDir = Join-Path $dshHome 'profiles\node_modules\dsh-image-vision'
if (Test-Path -LiteralPath $pkgDir) {
    Remove-Item -LiteralPath $pkgDir -Recurse -Force
    Write-Host "  OK  已删除插件包：$pkgDir"
} else {
    Write-Host '  --  插件包不存在，跳过'
}

# ---------- 2) 还原 apiproxy 白名单 ----------
$file = Find-ApiProxyFile
if ($file) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $content = [System.IO.File]::ReadAllText($file, $utf8)
    if ($content -match '"dsh-image-vision"') {
        $reverted = [regex]::Replace(
            $content,
            '"web-search-deepseek",\s*//[^\r\n]*dsh-image-vision[^\r\n]*\r?\n[ \t]*"dsh-image-vision"',
            '"web-search-deepseek"'
        )
        if ($reverted -ne $content) {
            [System.IO.File]::WriteAllText($file, $reverted, $utf8)
            Write-Host "  OK  已还原 apiproxy 白名单：$file"
        } else {
            Write-Host '  !!  apiproxy 白名单还原失败（未匹配到插入内容），请手动检查'
        }
    } else {
        Write-Host '  --  apiproxy 未打过补丁，跳过'
    }
} else {
    Write-Host '  --  未找到 dsh-host-apiproxy/lib/index.js，跳过白名单还原'
}

# ---------- 3) 移除 profile patch 行 ----------
$profiles = Join-Path $dshHome 'profiles'
$found = $false
if (Test-Path -LiteralPath $profiles) {
    foreach ($patchFile in Get-ChildItem -LiteralPath $profiles -Recurse -Filter 'cordis.patch.yml' -File) {
        $text = [System.IO.File]::ReadAllText($patchFile.FullName, (New-Object System.Text.UTF8Encoding($false)))
        $pattern = '(?m)^[ \t]*# dsh-image-vision: give text-only models image understanding[^\r\n]*\r?\n[ \t]*- insert:\r?\n[ \t]*- id: image-vision\r?\n[ \t]*name: dsh-image-vision\r?\n[ \t]*config:\r?\n[ \t]*enabled: true\r?\n[ \t]*patchAdmission: true\r?\n'
        $next = [regex]::Replace($text, $pattern, '')
        if ($next -ne $text) {
            $next = $next.TrimEnd() + "`r`n"
            [System.IO.File]::WriteAllText($patchFile.FullName, $next, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "  OK  已移除 image-vision 行：$($patchFile.FullName)"
            $found = $true
        } else {
            Write-Host "  --  $($patchFile.FullName) 中未找到 image-vision 行，跳过"
        }
    }
}
if (-not $found) { Write-Host '  --  未找到任何含 image-vision 行的 cordis.patch.yml' }

# ---------- 4) 可选：清理 settings.yaml 配置 ----------
if ($PurgeConfig) {
    $settingsFile = Join-Path $dshHome 'settings.yaml'
    if (Test-Path -LiteralPath $settingsFile) {
        $text = [System.IO.File]::ReadAllText($settingsFile, (New-Object System.Text.UTF8Encoding($false)))
        if ($text -match '(?m)^dsh-image-vision:\s*$') {
            $pattern = '(?m)^dsh-image-vision:[^\r\n]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*'
            $next = [regex]::Replace($text, $pattern, '')
            [System.IO.File]::WriteAllText($settingsFile, $next.TrimEnd() + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
            Write-Host '  OK  已清理 settings.yaml 中的 dsh-image-vision 配置'
        } else {
            Write-Host '  --  settings.yaml 中没有 dsh-image-vision 配置，跳过'
        }
    }
}

Write-Host ''
Write-Host '卸载完成！请重启 DSH 后生效。'
