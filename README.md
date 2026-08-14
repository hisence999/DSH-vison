# DSH Vision · 图片理解插件

[English](README.en.md)

为**不支持多模态的模型**提供图片理解能力：无论当前是否多模态模型，你都可以直接发送图片；纯文本模型会自动把图片拦截下来，调用一个已配置的多模态模型识别，再把**文字描述**回传给模型。

## 功能

1. **纯文本模型直接发图**：绕过发送时的「当前模型不支持图片」拦截，图片正常进入对话，模型看到的是一段 `[图片内容描述] …` 文字。
2. **`read_image` 工具可用**：纯文本模型调用 `read_image` 读图片时，同样能拿到图片的文字描述，而不是报 `UNSUPPORTED_CONTENT`。
3. **多模态自动检测**：多模态模型原样放行、不拦截、不浪费 token。
4. **全局生效（插件形式）**：以宿主插件挂载后，任何预设/模式下都运行。

## 工作原理

- 包装 `llm.resolveModelInfo`：让纯文本模型在「发送准入 / 工具门禁」两层都放行图片（可关闭）。
- 监听 `agent/pre-step`：在请求冻结前，把消息里的图片块（含 tool-result 内嵌图片）替换成描述文字。
- 监听 `tools/post-execute`：在 `read_image` 结果写入历史前，把图片块替换成描述文字。
- 真实多模态判定使用**包装前的原始方法**，避免误判。

## 安装

### 方式一：插件形式（推荐，全局生效）

这是宿主组合（host composition）插件，通过 profile 补丁层挂载，**在任何预设/模式下都运行**、重启后仍在。

1. 把 `host-plugin/` 目录复制为 `$DSH_HOME/profiles/<profile>/node_modules/dsh-image-vision/`（`<profile>` 是你的 profile 名，Web 版通常是 `web`；Windows 完整路径类似 `C:\Users\<你>\.dsh\profiles\web\node_modules\dsh-image-vision`）。
2. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
```

3. 重启 DSH（或等补丁层 HMR 热重载）。

配置项（写在 `config:` 里，均可省略）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `patchAdmission` | `true` | 放行纯文本模型发图（及 `read_image` 门禁） |
| `provider` / `model` | 空 = 自动探测 | 手动指定识别图片的多模态模型 |
| `prompt` | 见源码 | 描述图片用的提示词 |

### 方式二：预设形式（持久化，仅选中该预设的会话生效）

1. 把 `preset/` 目录复制为 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/dsh-vision/`。
2. 新建会话时选择「DSH Vision」预设。
3. 识别模型自动探测；如需手动指定，编辑 `preset/plugin.mjs` 里的 `config.provider` / `config.model`。

### 方式三：动态插件（完整功能，含设置页，进程内临时）

1. 打开 DSH 动态 Cordis 插件面板，新建插件（前缀可填 `imgvis`）。
2. Host 代码框粘贴 [`src/host.js`](src/host.js)，Client 代码框粘贴 [`src/client.js`](src/client.js)。
3. 运行并批准，打开「设置 → 图片理解」配置。

> 动态插件是进程内临时对象，重启后失效。

## 限制与说明

- **需要 DSH 里至少已配置一个支持图片的模型**，否则无法生成描述。
- 识别描述会**按图片内容哈希（attachmentId）缓存**，同一张图只识别一次。
- `patchAdmission` 是对共享 `llm` 服务的一次**可逆包装**，停止/更新插件时会还原；它可能让个别界面把纯文本模型显示为“支持图片”（仅展示层面，不影响真实调用）。
- 会话中途切换模型后的**第一步**可能仍按旧模型判定（存在 1 步滞后）。

## 安全

本仓库**不含任何密钥**：不硬编码 API Key、端点或供应商，识别模型一律从你 DSH 自身已配置的供应商中读取。请勿自行添加凭据。

## License

[MIT](LICENSE)
