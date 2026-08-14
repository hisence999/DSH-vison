# DSH Vision 一键安装脚本（Windows PowerShell）
# 用法（一行命令）：
#   irm https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME }
           elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
           else { Join-Path $HOME '.dsh' }

$dest = Join-Path $dshHome '.agent-presets\dsh-vision'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$base = 'https://raw.githubusercontent.com/hisence999/DSH-vison/main/preset'
$files = @('agent.cordis.yml', 'preset.yml', 'plugin.mjs')

Write-Host "安装 DSH Vision 到：$dest"
foreach ($f in $files) {
    Invoke-WebRequest -Uri "$base/$f" -OutFile (Join-Path $dest $f) -UseBasicParsing
    Write-Host "  OK  $f"
}

Write-Host ''
Write-Host '完成！在 DSH 新建会话时选择「DSH Vision」预设即可。'
Write-Host '识别模型会自动探测；如需手动指定，编辑该目录下的 plugin.mjs。'
