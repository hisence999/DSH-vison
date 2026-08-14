# DSH Vision · Image Understanding Plugin

[中文](README.md)

Give **text-only models** the ability to "see" images: you can always send images, and when the active model does not support images, the plugin transparently replaces the image with a **text description** produced by a vision-capable model.

## Features

1. **Send images to text-only models**: bypasses the "current model does not support images" admission; the **conversation shows the image normally** (just like with a multimodal model), while the model actually receives a `[图片内容描述] …` text description.
2. **`read_image` works for text-only models**: returns a text description instead of `UNSUPPORTED_CONTENT`.
3. **Automatic multimodal detection**: vision-capable models pass through untouched.
4. **Global (plugin form)**: as a host plugin it runs in every preset / mode.

## How it works

- Wraps `llm.resolveModelInfo`: makes the "send admission / tool gate" accept images for text-only models (can be disabled).
- Listens to `agent/pre-step`: pre-computes a text description for every image-bearing user message; the message itself stays as an **image** in the session history (the UI shows the image), while a **model-visible replacement** (session surface replace + a `deriveMessages` wrapper) gives the model the text description — the two never conflict, and the persisted replacement survives session resume.
- Listens to `tools/post-execute`: replaces `read_image`'s image block with description text before it is committed.
- Listens to `system-prompt/assemble`: captures the model actually in effect for the current step (including the in-session UI selection), so multimodal detection has **zero lag**.
- Real multimodal detection uses the **original (pre-wrap) method**.

## Install

### Method 1: one-line installer (recommended, global)

A host-composition plugin mounted through the profile patch layer: runs in **every preset/mode** and survives restarts.

Windows (PowerShell, one line):

```powershell
irm https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.ps1 | iex
```

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.sh | bash
```

The installer does three things:

1. **Patches the apiproxy allowlist**: adds `dsh-image-vision` to the settings-page namespace exposure allowlist (see "Settings page requirement" below);
2. Copies the plugin (`index.js` / `client.js` / `package.json`) to `$DSH_HOME/profiles/node_modules/dsh-image-vision/`;
3. Appends the `image-vision` row to every `$DSH_HOME/profiles/<name>/cordis.patch.yml` (idempotent; safe to re-run).

**Restart DSH after installing**, then open **"Settings → 图片理解"** for a visual config page (switches, vision model, prompt); changes apply immediately. The config persists in the settings namespace `dsh-image-vision` (also editable in `settings.yaml`); the `config` in `cordis.patch.yml` is only a fallback when settings is unavailable.

### Method 2: manual install (equivalent to the one-line installer)

1. Copy `index.js`, `client.js` and `package.json` from the repository root to `$DSH_HOME/profiles/<profile>/node_modules/dsh-image-vision/` (`<profile>` is your profile name, usually `web` for the web app; e.g. `C:\Users\<you>\.dsh\profiles\web\node_modules\dsh-image-vision` on Windows).
2. Run [patch-apiproxy.ps1](patch-apiproxy.ps1) (Windows) or [patch-apiproxy.sh](patch-apiproxy.sh) (Linux/macOS) to add `dsh-image-vision` to the `dsh-host-apiproxy` settings exposure allowlist.
3. Append to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
```

4. Restart DSH.

## Settings page requirement (apiproxy exposure allowlist)

DSH's settings page only exposes namespaces from a **hardcoded allowlist** (`WEB_SETTINGS_NAMESPACES` in `dsh-host-apiproxy/lib/index.js`; the source comment explicitly marks this as the decision point for plugin settings sections). So the plugin's own namespace `dsh-image-vision` is **not** served to the settings page by default — without the patch the page shows "未找到 dsh-image-vision 设置命名空间".

The installer adds the namespace to that allowlist idempotently. **Upgrading/reinstalling DSH (e.g. `npm update @deepseek-ai/dsh`) overwrites the file — re-run the installer afterwards.**

## Uninstall

Windows (PowerShell, one line):

```powershell
irm https://raw.githubusercontent.com/hisence999/DSH-vison/main/uninstall.ps1 | iex
```

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vison/main/uninstall.sh | bash
```

The uninstaller removes the plugin package, the `image-vision` row from every `cordis.patch.yml`, and reverts the apiproxy allowlist patch (idempotent; safe to re-run). The `settings.yaml` config is kept by default (restored automatically on reinstall); pass `-PurgeConfig` (Windows) or `--purge-config` (Unix) to remove it too. **Restart DSH after uninstalling.**

## Caveats

- **At least one image-capable model must be configured in your DSH**, otherwise no description can be generated.
- **Descriptions are not cached**: every image send triggers a fresh vision call (the same image appearing twice in one step is described only once per step, to avoid double billing).
- `patchAdmission` is a **reversible wrapper** around the shared `llm` service; it is restored on stop/update. It may make some UIs display a text-only model as "image-capable" (display-only).

## Security

This repository ships **no secrets**: no API keys, endpoints, or provider credentials are hardcoded. The vision model is always resolved from the providers you have already configured in your own DSH.

## License

[MIT](LICENSE)
