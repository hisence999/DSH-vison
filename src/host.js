/*
 * DSH Vision — Host 半部（动态 Cordis 插件）
 * 用法：把本文件从 `return {` 开始的内容粘贴到 DSH 动态插件的 Host 代码框。
 * 配套的 Client 代码见 src/client.js。
 *
 * Host half of the DSH Vision dynamic Cordis plugin.
 * Paste everything from `return {` into the Host code box.
 * Pair with src/client.js for the Client half.
 */
return {
  apply(ctx) {
    const llm = ctx.get('llm')
    if (llm === undefined) return
    const agentDefaultModel = ctx.get('agentDefaultModel')

    const config = {
      enabled: true,
      patchAdmission: true, // 包装 resolveModelInfo，让发送/read_image 门禁对纯文本模型放行
      provider: '', // 空 = 自动探测一个支持图片的模型
      model: '',
      prompt: '请仔细观察这张图片并详细描述其内容，包括：所有可见的文字（请逐字转录）、物体、人物、场景、布局、颜色以及任何值得注意的细节。请用中文回答。',
    }

    // 保存原始 resolveModelInfo（未绑定原型方法），供真实能力判定与还原。
    const originalResolveModelInfo = typeof llm.resolveModelInfo === 'function' ? llm.resolveModelInfo : null
    const realResolveModelInfo = originalResolveModelInfo ? originalResolveModelInfo.bind(llm) : null
    let admissionPatched = false

    function patchAdmission() {
      if (!originalResolveModelInfo || !realResolveModelInfo || admissionPatched) return
      try {
        llm.resolveModelInfo = async function (provider, model, signal) {
          const info = await realResolveModelInfo(provider, model, signal)
          const mods = Array.isArray(info.inputModalities) ? info.inputModalities.slice() : ['text']
          if (mods.indexOf('image') === -1) {
            return Object.assign({}, info, { inputModalities: mods.concat('image') })
          }
          return info
        }
        admissionPatched = true
      } catch (e) {
        console.error('[imgvis] 无法包装 resolveModelInfo:', e)
      }
    }
    function unpatchAdmission() {
      if (!admissionPatched || !originalResolveModelInfo) return
      try { llm.resolveModelInfo = originalResolveModelInfo } catch (e) { /* ignore */ }
      admissionPatched = false
    }
    if (config.patchAdmission) patchAdmission()

    const descriptions = new Map()
    const modelByAgent = new Map()

    async function findVisionModel() {
      if (config.provider && config.model) return { provider: config.provider, model: config.model }
      for (const p of llm.listProviders()) {
        try {
          const models = await llm.listModels(p.id)
          for (const m of models) {
            if ((m.inputModalities || []).indexOf('image') !== -1) {
              return { provider: p.id, model: m.id }
            }
          }
        } catch (e) { /* ignore */ }
      }
      return null
    }

    // 用原始方法判真实多模态能力（不受上面的包装影响）。
    async function supportsImage(provider, model) {
      if (!provider || !model || !realResolveModelInfo) return false
      try {
        const info = await realResolveModelInfo(provider, model)
        return (info.inputModalities || []).indexOf('image') !== -1
      } catch (e) {
        return false
      }
    }

    async function describe(ref) {
      if (descriptions.has(ref.attachmentId)) return descriptions.get(ref.attachmentId)
      const vision = await findVisionModel()
      if (!vision) return null
      const messages = [{
        id: 'imgvis-' + String(descriptions.size),
        role: 'user',
        content: [
          { type: 'text', text: config.prompt },
          { type: 'image', attachment: ref },
        ],
        source: { kind: 'user' },
      }]
      let text = ''
      try {
        for await (const chunk of llm.stream({ provider: vision.provider, model: vision.model, messages })) {
          if (chunk.type === 'text-delta') text += chunk.text
        }
      } catch (e) {
        console.error('[imgvis] 视觉识别失败:', e)
        return null
      }
      if (text.trim().length === 0) return null
      descriptions.set(ref.attachmentId, text)
      return text
    }

    function currentModel(agent) {
      const opts = agent && agent.options
      if (opts && opts.provider && opts.model) return { provider: opts.provider, model: opts.model }
      const cached = modelByAgent.get(String(agent && agent.id))
      if (cached) return cached
      try {
        const d = agentDefaultModel ? agentDefaultModel.currentSelection() : undefined
        if (d && d.provider && d.model) return { provider: d.provider, model: d.model }
      } catch (e) { /* ignore */ }
      return null
    }

    function hasImageBlock(blocks) {
      for (const b of blocks) {
        if (!b) continue
        if (b.type === 'image') return true
        if (b.type === 'tool-result' && Array.isArray(b.content) && hasImageBlock(b.content)) return true
      }
      return false
    }

    // 递归把 image 块替换为文字描述（覆盖直接图片与 tool-result 内嵌图片）。
    async function transformBlocks(blocks) {
      const out = []
      let changed = false
      for (const b of blocks) {
        if (!b) { out.push(b); continue }
        if (b.type === 'image' && b.attachment) {
          const desc = await describe(b.attachment)
          if (desc) {
            out.push({ type: 'text', text: '\n[图片内容描述]\n' + desc + '\n' })
            changed = true
            continue
          }
          out.push(b)
        } else if (b.type === 'tool-result' && Array.isArray(b.content)) {
          const inner = await transformBlocks(b.content)
          if (inner.changed) {
            out.push(Object.assign({}, b, { content: inner.blocks }))
            changed = true
          } else {
            out.push(b)
          }
        } else {
          out.push(b)
        }
      }
      return { blocks: out, changed }
    }

    const offRequest = ctx.on('agent/request', async (payload, next) => {
      const cfg = await next()
      try {
        if (cfg && cfg.provider && cfg.model) {
          modelByAgent.set(String(payload.agent && payload.agent.id), { provider: cfg.provider, model: cfg.model })
        }
      } catch (e) { /* ignore */ }
      return cfg
    })

    const offPreStep = ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (!decision || decision.kind !== 'enter') return decision
      if (!config.enabled) return decision

      const agent = payload.agent
      const cur = currentModel(agent)
      if (cur && await supportsImage(cur.provider, cur.model)) return decision

      const messages = decision.messages || []
      let found = false
      for (const m of messages) {
        if (m && Array.isArray(m.content) && hasImageBlock(m.content)) { found = true; break }
      }
      if (!found) return decision

      const out = []
      for (const m of messages) {
        const blocks = (m && Array.isArray(m.content)) ? m.content : []
        const transformed = await transformBlocks(blocks)
        if (transformed.changed) {
          out.push({ id: m.id, role: m.role, content: transformed.blocks, source: m.source })
        } else {
          out.push(m)
        }
      }
      return { kind: 'enter', messages: out }
    })

    // read_image 的结果在物化进历史前，把图片块替换成描述文字。
    const offPostExecute = ctx.on('tools/post-execute', async (exec, result, next) => {
      if (exec.name !== 'read_image') return next()
      const decision = await next()
      if (decision.kind !== 'accept') return decision
      if (result.isError) return decision
      if (!config.enabled) return decision

      const cur = currentModel(exec.agent)
      if (cur && await supportsImage(cur.provider, cur.model)) return decision

      const imageBlock = (result.content || []).find((b) => b && b.type === 'image')
      if (!imageBlock || !imageBlock.attachment) return decision

      const desc = await describe(imageBlock.attachment)
      if (!desc) return decision

      const env = (result.content || [])
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return {
        kind: 'accept',
        content: [{ type: 'text', text: (env ? env + '\n' : '') + '[图片内容描述]\n' + desc }],
      }
    })

    const offGetConfig = harness.handle('get-config', async () => {
      let resolved = null
      try { resolved = await findVisionModel() } catch (e) { /* ignore */ }
      const providers = []
      for (const p of llm.listProviders()) {
        let visionModels = []
        try {
          visionModels = (await llm.listModels(p.id))
            .filter((m) => (m.inputModalities || []).indexOf('image') !== -1)
            .map((m) => m.id)
        } catch (e) { /* ignore */ }
        providers.push({ id: p.id, name: p.name, visionModels: visionModels })
      }
      return {
        enabled: config.enabled,
        patchAdmission: config.patchAdmission,
        provider: config.provider,
        model: config.model,
        prompt: config.prompt,
        resolved: resolved ? { provider: resolved.provider, model: resolved.model } : null,
        providers: providers,
      }
    })

    const offSetConfig = harness.handle('set-config', async (args) => {
      if (args && typeof args === 'object') {
        if ('enabled' in args) config.enabled = !!args.enabled
        if ('patchAdmission' in args) {
          config.patchAdmission = !!args.patchAdmission
          if (config.patchAdmission) patchAdmission(); else unpatchAdmission()
        }
        if ('provider' in args) config.provider = String(args.provider || '')
        if ('model' in args) config.model = String(args.model || '')
        if ('prompt' in args) config.prompt = String(args.prompt || '')
      }
      descriptions.clear()
      return { ok: true }
    })

    return () => {
      offRequest()
      offPreStep()
      offPostExecute()
      offGetConfig()
      offSetConfig()
      unpatchAdmission()
    }
  },
}
