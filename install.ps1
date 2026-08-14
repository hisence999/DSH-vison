# DSH Vision 一键安装脚本（Windows PowerShell）
# 用法（一行命令）：
#   irm https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.ps1 | iex
#
# 安装内容：
#   1) 打 apiproxy 补丁：把 dsh-image-vision 加入 settings 暴露白名单（设置页必需）
#   2) 全局安装 host 插件：复制到 $DSH_HOME/profiles/node_modules/dsh-image-vision
#   3) 写入 profile patch：把 image-vision 行追加到每个 profiles/<name>/cordis.patch.yml
#   4) （可选，-Preset）安装「DSH Vision」会话预设到 .agent-presets/dsh-vision
# 安装完成后需要重启 DSH。
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME }
           elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
           else { Join-Path $HOME '.dsh' }

$base = 'https://raw.githubusercontent.com/hisence999/DSH-vison/main'

# ---------- 1) apiproxy 暴露白名单补丁（幂等） ----------
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

function Patch-ApiProxy {
    $file = Find-ApiProxyFile
    if (-not $file) {
        Write-Host '  !! 未找到 dsh-host-apiproxy/lib/index.js，跳过白名单补丁（设置页将不可用）'
        return
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $content = [System.IO.File]::ReadAllText($file, $utf8)
    if ($content -match '"dsh-image-vision"') {
        Write-Host "  OK  apiproxy 已打过补丁：$file"
        return
    }
    $anchor = '"web-search-deepseek"'
    if (-not $content.Contains($anchor)) {
        Write-Host '  !! 未找到白名单锚点，跳过 apiproxy 补丁（DSH 版本可能不兼容）'
        return
    }
    $insert = "`t$anchor,`r`n`t// dsh-image-vision: settings section for the DSH-vison plugin (added by DSH-vison installer)`r`n`t`"dsh-image-vision`""
    $content = $content.Replace($anchor, $insert)
    [System.IO.File]::WriteAllText($file, $content, $utf8)
    Write-Host "  OK  apiproxy 白名单已加入 dsh-image-vision：$file"
}

Write-Host '== 1/3 打 apiproxy 设置白名单补丁 =='
Patch-ApiProxy

# ---------- 2) 全局 host 插件 ----------
$pkgDir = Join-Path $dshHome 'profiles\node_modules\dsh-image-vision'
New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
Write-Host ''
Write-Host ("== 2/3 安装全局 host 插件到 " + $pkgDir + " ==")
foreach ($f in @('index.js', 'client.js', 'package.json')) {
    Invoke-WebRequest -Uri "$base/host-plugin/$f" -OutFile (Join-Path $pkgDir $f) -UseBasicParsing
    Write-Host "  OK  $f"
}

# ---------- 3) profile patch 行 ----------
Write-Host ''
Write-Host '== 3/3 写入 profile patch（image-vision 行） =='
$patchRow = @'
# dsh-image-vision: give text-only models image understanding (auto-describes images).
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
'@
$profiles = Join-Path $dshHome 'profiles'
$patched = $false
if (Test-Path -LiteralPath $profiles) {
    foreach ($patchFile in Get-ChildItem -LiteralPath $profiles -Recurse -Filter 'cordis.patch.yml' -File) {
        $text = [System.IO.File]::ReadAllText($patchFile.FullName, (New-Object System.Text.UTF8Encoding($false)))
        if ($text -match '(?m)^\s*- id: image-vision\s*$') {
            Write-Host "  OK  已存在：$($patchFile.FullName)"
        } else {
            $text = $text.TrimEnd() + "`r`n" + $patchRow + "`r`n"
            [System.IO.File]::WriteAllText($patchFile.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "  OK  已写入：$($patchFile.FullName)"
        }
        $patched = $true
    }
}
if (-not $patched) { Write-Host '  !! 未找到任何 profiles/*/cordis.patch.yml，请手动添加 image-vision 行' }

# ---------- 4) 可选：会话预设 ----------
if ($args -contains '-Preset' -or $args -contains '-preset') {
    Write-Host ''
    Write-Host '== 附加：安装「DSH Vision」会话预设 =='
    $dest = Join-Path $dshHome '.agent-presets\dsh-vision'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    foreach ($f in @('agent.cordis.yml', 'preset.yml', 'plugin.mjs')) {
        Invoke-WebRequest -Uri "$base/preset/$f" -OutFile (Join-Path $dest $f) -UseBasicParsing
        Write-Host "  OK  $f"
    }
}

Write-Host ''
Write-Host '完成！请重启 DSH（退出 dsh 进程后重新运行），然后在「设置 → 图片理解」中查看/保存配置。'
