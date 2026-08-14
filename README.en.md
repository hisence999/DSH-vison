# DSH Vision · Image Understanding Plugin

[中文](README.md)

Give **text-only models** the ability to "see" images: you can always send images, and when the active model does not support images, the plugin transparently replaces the image with a **text description** produced by a vision-capable model.

## Features

1. **Send images to text-only models**: bypasses the "current model does not support images" admission; the model sees a `[图片内容描述] …` text instead.
2. **`read_image` works for text-only models**: returns a text description instead of `UNSUPPORTED_CONTENT`.
3. **Automatic multimodal detection**: vision-capable models pass through untouched.
4. **Global (plugin form)**: as a host plugin it runs in every preset / mode.

## How it works

- Wraps `llm.resolveModelInfo`: makes the "send admission / tool gate" accept images for text-only models (can be disabled).
- Listens to `agent/pre-step`: replaces image blocks (including those nested in tool results) with description text before the request is frozen.
- Listens to `tools/post-execute`: replaces `read_image`'s image block with description text before it is committed.
- Real multimodal detection uses the **original (pre-wrap) method**.

## Install

### Method 1: plugin form (recommended, global)

A host-composition plugin mounted through the profile patch layer: runs in **every preset/mode** and survives restarts.

1. Copy the `host-plugin/` folder to `$DSH_HOME/profiles/<profile>/node_modules/dsh-image-vision/` (`<profile>` is your profile name, usually `web` for the web app; e.g. `C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-image-vision` on Windows).
2. Append to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
```

3. Restart DSH (or wait for the patch-layer HMR).

Config fields (all optional, under `config:`):

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `patchAdmission` | `true` | Let text-only models accept images (and pass the `read_image` gate) |
| `provider` / `model` | empty = auto-detect | Pin the vision model used to describe images |
| `prompt` | see source | Prompt used to describe an image |

### Method 2: preset form (persistent, per selected preset)

1. Copy the `preset/` folder to `${DSH_HOME:-$HOME/.dsh}/.agent-presets/dsh-vision/`.
2. Start a session with the "DSH Vision" preset.
3. The vision model is auto-detected; edit `preset/plugin.mjs` to pin one.

### Method 3: dynamic plugin (full features, with settings page, process-local)

1. Open the DSH dynamic Cordis plugin panel; create a plugin (prefix e.g. `imgvis`).
2. Paste [`src/host.js`](src/host.js) into Host, [`src/client.js`](src/client.js) into Client.
3. Run, approve, then open "Settings → 图片理解".

> A dynamic plugin is process-local and disappears after a restart.

## Caveats

- **At least one image-capable model must be configured in your DSH**, otherwise no description can be generated.
- Descriptions are **cached by image content hash (attachmentId)** — the same image is described only once.
- `patchAdmission` is a **reversible wrapper** around the shared `llm` service; it is restored on stop/update. It may make some UIs display a text-only model as "image-capable" (display-only).
- The **first step after switching models mid-session** may still use the old model's capability (a 1-step lag).

## Security

This repository ships **no secrets**: no API keys, endpoints, or provider credentials are hardcoded. The vision model is always resolved from the providers you have already configured in your own DSH.

## License

[MIT](LICENSE)
