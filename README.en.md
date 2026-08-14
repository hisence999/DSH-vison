# DSH Vision · Image Understanding Plugin

[中文](README.zh-CN.md) · [Home](README.md)

Give **text-only models** the ability to "see" images: you can always send images, and when the active model does not support images, the plugin transparently replaces the image with a **text description** produced by a vision-capable model.

## Features

1. **Send images to text-only models**: bypasses the "current model does not support images" admission; the image enters the conversation normally, and the model sees a `[图片内容描述] …` text instead.
2. **`read_image` works for text-only models**: calling `read_image` returns a text description instead of `UNSUPPORTED_CONTENT`.
3. **Automatic multimodal detection**: vision-capable models pass through untouched — no interception, no wasted tokens.
4. **Settings page (dynamic version)**: pick the vision model, customize the prompt, toggle switches.

## How it works

- Listens to `agent/pre-step`: before a request is frozen, replaces image blocks (including those nested in tool results) with description text.
- Listens to `tools/post-execute`: replaces `read_image`'s image block with description text before it is written into session history.
- Wraps `llm.resolveModelInfo`: makes the "send admission / tool gate" accept images for text-only models (can be disabled in settings).
- Real multimodal detection uses the **original (pre-wrap) method**, to avoid misjudging.

## Install

> The repo ships two forms: `src/` is the **dynamic plugin source** (full features, with a settings page); `preset/` is a **persistent preset** (Host only, auto-detects the vision model). Pick one.

### Method A: dynamic plugin (full features, with settings page)

Requires the DSH "dynamic Cordis plugin" capability (`cordis` preset / cordis_* tools).

1. Open the DSH Web GUI and the dynamic Cordis plugin panel.
2. Create a new plugin (semantic prefix e.g. `imgvis`).
3. Paste the whole [`src/host.js`](src/host.js) into the Host code box.
4. Paste the whole [`src/client.js`](src/client.js) into the Client code box.
5. Run and approve.
6. Open "Settings → 图片理解" to pick the vision model.

> Note: a dynamic plugin is process-local and disappears after a DSH restart.

### Method B: persistent preset (no settings page, recommended)

1. Copy the `preset/` folder to `${DSH_HOME:-$HOME/.dsh}/.agent-presets/dsh-vision/` (on Windows, usually `C:\Users\<you>\.dsh\.agent-presets\dsh-vision`).
2. Start a new session with the **"DSH Vision"** preset (or mount it onto your session).
3. No configuration needed: the vision model is auto-detected (the first model that declares image input). To pin one, edit `config.provider` / `config.model` in `preset/plugin.mjs`.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `provider` / `model` | empty = auto-detect | The vision model used to describe images; empty auto-detects the first image-capable model |
| `prompt` | see source | The prompt used to describe an image |
| `patchAdmission` | `true` | Whether to let text-only models accept images (and pass the `read_image` gate) |
| `enabled` | `true` | Master switch |

## Caveats

- **At least one image-capable model must be configured in your DSH**, otherwise no description can be generated (the settings page shows "current model" as empty).
- Descriptions are **cached by image content hash (attachmentId)** — the same image is described only once.
- `patchAdmission` is a **reversible wrapper** around the shared `llm` service; it is restored when the plugin stops/updates. It may make some UIs display a text-only model as "image-capable" (display-only, no effect on real calls).
- The **first step after switching models mid-session** may still use the old model's capability (a 1-step lag).

## Security

This repository ships **no secrets**: no API keys, endpoints, or provider credentials are hardcoded. The vision model is always resolved from the providers you have already configured in your own DSH. Do not add credentials yourself.

## License

[MIT](LICENSE)
