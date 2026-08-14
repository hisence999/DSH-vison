/*
 * DSH Vision — Client 半部（动态 Cordis 插件）
 * 用法：把本文件从 `return {` 开始的内容粘贴到 DSH 动态插件的 Client 代码框。
 * 配套的 Host 代码见 src/host.js。
 *
 * Client half of the DSH Vision dynamic Cordis plugin.
 * Paste everything from `return {` into the Client code box.
 */
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(
      '.imgvis-select,.imgvis-textarea{' +
        'width:100%;padding:8px 10px;border-radius:6px;' +
        'border:1px solid var(--dsw-alias-border-l1);' +
        'background:var(--dsw-alias-bg-layer-1);' +
        'color:var(--dsw-alias-label-primary);' +
        'font-size:13px;box-sizing:border-box;font-family:inherit;' +
      '}' +
      '.imgvis-select option{' +
        'background:var(--dsw-alias-bg-layer-1);' +
        'color:var(--dsw-alias-label-primary);' +
      '}' +
      '.imgvis-textarea{min-height:96px;resize:vertical;}' +
      '.imgvis-btn{' +
        'box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:none;' +
        'border-radius:18px;justify-content:center;align-items:center;' +
        'padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;' +
        'background:var(--dsw-alias-button-primary-fill);' +
        'color:var(--dsw-alias-label-primary-foreground);' +
      '}' +
      '.imgvis-btn:hover:not(:disabled){opacity:.88;}' +
      '.imgvis-btn:disabled{opacity:.5;cursor:default;}' +
      '.imgvis-hint{opacity:0.6;}' +
      '.imgvis-ok{color:var(--dsw-alias-state-success-primary);}' +
      '.imgvis-muted{opacity:0.6;}'
    )

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'image-vision', order: 30, label: '图片理解' },
      () => React.createElement(Settings, null),
    ))

    function Field(props) {
      return React.createElement('div', { style: { marginBottom: 18 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 7 } }, props.label),
        props.children,
        props.hint ? React.createElement('div', { className: 'imgvis-hint', style: { fontSize: 12, marginTop: 5 } }, props.hint) : null,
      )
    }

    function Settings() {
      const [cfg, setCfg] = React.useState(null)
      const [enabled, setEnabled] = React.useState(true)
      const [patchAdmission, setPatchAdmission] = React.useState(true)
      const [provider, setProvider] = React.useState('')
      const [model, setModel] = React.useState('')
      const [prompt, setPrompt] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [saved, setSaved] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        host.call('get-config').then((c) => {
          if (!alive || !c) return
          setCfg(c)
          setEnabled(!!c.enabled)
          setPatchAdmission(c.patchAdmission !== false)
          setProvider(c.provider || '')
          setModel(c.model || '')
          setPrompt(c.prompt || '')
        }).catch(() => {})
        return () => { alive = false }
      }, [])

      const providers = (cfg && cfg.providers) || []
      const selected = providers.find((p) => p.id === provider)
      const models = selected ? selected.visionModels : []

      async function save() {
        setBusy(true)
        setSaved(false)
        try {
          await host.call('set-config', { enabled: enabled, patchAdmission: patchAdmission, provider: provider, model: model, prompt: prompt })
          const c = await host.call('get-config')
          setCfg(c)
          setSaved(true)
        } finally {
          setBusy(false)
        }
      }

      return React.createElement('div', { style: { maxWidth: 560 } },
        React.createElement(Field, { label: '启用图片理解', hint: '当模型不支持图片时，自动用视觉模型生成文字描述代替图片' },
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: enabled, onChange: (e) => setEnabled(e.target.checked) }),
            '拦截图片并替换为文字描述',
          ),
        ),
        React.createElement(Field, { label: '允许向纯文本模型发送图片', hint: '绕过发送时的“当前模型不支持图片”拦截，以及 read_image 工具的门禁；图片会被自动识别成文字' },
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: patchAdmission, onChange: (e) => setPatchAdmission(e.target.checked) }),
            '放行图片（自动识别为文字）',
          ),
        ),
        React.createElement(Field, { label: '识别图片的模型', hint: '留空 = 自动探测第一个支持图片的模型' },
          React.createElement('select', { className: 'imgvis-select', value: provider, onChange: (e) => { setProvider(e.target.value); setModel('') } },
            React.createElement('option', { value: '' }, '自动检测'),
            providers.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.name + ' (' + p.id + ')')),
          ),
          React.createElement('div', { style: { marginTop: 8 } },
            React.createElement('select', { className: 'imgvis-select', value: model, onChange: (e) => setModel(e.target.value) },
              React.createElement('option', { value: '' }, '该供应商自动选择'),
              models.map((m) => React.createElement('option', { key: m, value: m }, m)),
            ),
          ),
        ),
        React.createElement(Field, { label: '描述提示词' },
          React.createElement('textarea', { className: 'imgvis-textarea', value: prompt, onChange: (e) => setPrompt(e.target.value) }),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 } },
          React.createElement('button', { className: 'imgvis-btn', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
          saved ? React.createElement('span', { className: 'imgvis-ok', style: { fontSize: 12 } }, '已保存') : null,
        ),
        cfg && cfg.resolved ? React.createElement('div', { className: 'imgvis-muted', style: { marginTop: 16, fontSize: 12 } },
          '当前生效的识别模型：' + cfg.resolved.provider + ' / ' + cfg.resolved.model,
        ) : null,
      )
    }
  },
}
