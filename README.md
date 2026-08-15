# DSH Vision · 图片理解插件

[English](README.en.md)

为**不支持多模态的模型**提供图片理解能力：无论当前是否多模态模型，你都可以直接发送图片；纯文本模型会自动把图片拦截下来，调用一个已配置的多模态模型识别，再把**文字描述**回传给模型。

## 功能

1. **纯文本模型直接发图**：绕过发送时的「当前模型不支持图片」拦截；**对话记录里正常显示图片**（和多模态模型一致），模型实际看到的是 `[图片内容描述] …` 文字。
2. **`read_image` 工具可用**：纯文本模型调用 `read_image` 读图片时，同样能拿到图片的文字描述，而不是报 `UNSUPPORTED_CONTENT`。
3. **多模态自动检测**：多模态模型原样放行、不拦截、不浪费 token。
4. **全局生效（插件形式）**：以宿主插件挂载后，任何预设/模式下都运行。

## 工作原理

- 包装 `llm.resolveModelInfo`：让纯文本模型在「发送准入 / 工具门禁」两层都放行图片（可关闭）。
- 监听 `agent/pre-step`：为含图片的用户消息预计算描述文字；消息本身**保留图片**写入会话历史（UI 显示图片），并通过「模型可见替换」（session surface replace + `deriveMessages` 包装）让模型收到文字描述——两者互不干扰，持久化替换在会话恢复后依然生效。
- 监听 `tools/post-execute`：在 `read_image` 结果写入历史前，把图片块替换成描述文字。
- 监听 `system-prompt/assemble`：捕获本次步骤实际生效的模型（含会话 UI 选择），多模态判定**零滞后**。
- 真实多模态判定使用**包装前的原始方法**，避免误判。

## 安装

### 方式一：一键安装（推荐，全局生效）

这是宿主组合（host composition）插件，通过 profile 补丁层挂载，**在任何预设/模式下都运行**、重启后仍在。

Windows（PowerShell 一行）：

```powershell
irm https://raw.githubusercontent.com/hisence999/DSH-vision/main/install.ps1 | iex
```

Linux / macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vision/main/install.sh | bash
```

安装脚本会做三件事：

1. **打 apiproxy 白名单补丁**：把 `dsh-image-vision` 加入 DSH 设置页的命名空间暴露白名单（见下方「设置页要求」）；
2. 把插件本体（`index.js` / `client.js` / `package.json`）复制为 `$DSH_HOME/profiles/node_modules/dsh-image-vision/`；
3. 在每个 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 末尾追加 `image-vision` 行（幂等，重复执行安全）。

**安装完成后请重启 DSH**，然后打开 **「设置 → 图片理解」** 即可可视化配置（开关、识别模型、提示词），保存后立即生效。配置持久化在 settings 命名空间 `dsh-image-vision`（也可直接编辑 `settings.yaml`）；`cordis.patch.yml` 里的 `config` 仅作 settings 不可用时的兜底。

### 方式二：手动安装（与一键安装等价）

1. 把仓库根目录的 `index.js`、`client.js`、`package.json` 复制到 `$DSH_HOME/profiles/<profile>/node_modules/dsh-image-vision/`（`<profile>` 是你的 profile 名，Web 版通常是 `web`；Windows 完整路径类似 `C:\Users\<你>\.dsh\profiles\web\node_modules\dsh-image-vision`）。
2. 运行 [patch-apiproxy.ps1](patch-apiproxy.ps1)（或 Linux/macOS 的 [patch-apiproxy.sh](patch-apiproxy.sh)），把 `dsh-image-vision` 加入 `dsh-host-apiproxy` 的设置暴露白名单。
3. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
```

4. 重启 DSH。

## 设置页要求（apiproxy 暴露白名单）

DSH 的设置页只向客户端暴露一个**写死的命名空间白名单**（`dsh-host-apiproxy/lib/index.js` 里的 `WEB_SETTINGS_NAMESPACES`；源码注释明确说明这是插件设置页的决策点）。因此插件自己的设置命名空间 `dsh-image-vision` 默认**不会**出现在设置页 —— 未打补丁时页面会提示「未找到 dsh-image-vision 设置命名空间」。

安装脚本会幂等地把这个命名空间加进白名单。**升级/重装 DSH（`npm update @deepseek-ai/dsh` 等）会覆盖该文件，需要重新运行安装脚本。**

## 卸载

Windows（PowerShell 一行）：

```powershell
irm https://raw.githubusercontent.com/hisence999/DSH-vision/main/uninstall.ps1 | iex
```

Linux / macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vision/main/uninstall.sh | bash
```

卸载脚本会删除插件包、移除 `cordis.patch.yml` 里的 `image-vision` 行、还原 apiproxy 白名单补丁（幂等，可重复执行）。`settings.yaml` 里的配置默认保留（重装后自动恢复），如需一并清理加 `-PurgeConfig`（Windows）或 `--purge-config`（Unix）。**卸载后需重启 DSH。**

## 限制与说明

- **需要 DSH 里至少已配置一个支持图片的模型**，否则无法生成描述。
- **不缓存描述**：每次发送图片都会调用视觉模型重新识别（同一轮内同一张图只识别一次，避免重复计费）。
- **识别失败自动重试**：视觉模型调用失败时会依次重试其它已配置的支持图片的模型（间隔 0.6s）；全部失败则用占位文字兜底，**不会**把图片原样发给纯文本模型导致回合报错。
- `patchAdmission` 是对共享 `llm` 服务的一次**可逆包装**，停止/更新插件时会还原；它可能让个别界面把纯文本模型显示为“支持图片”（仅展示层面，不影响真实调用）。

## 安全

本仓库**不含任何密钥**：不硬编码 API Key、端点或供应商，识别模型一律从你 DSH 自身已配置的供应商中读取。请勿自行添加凭据。

## 致谢

感谢 [Linux.do](https://linux.do) 社区的支持与帮助！

## License

[MIT](LICENSE)
