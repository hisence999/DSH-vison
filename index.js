'use strict'

/**
 * dsh-image-vision — DSH host-composition plugin.
 *
 * Gives text-only models the ability to "see" images:
 *  - wraps llm.resolveModelInfo so text-only models pass the send admission
 *    and the read_image route gate (images get admitted instead of rejected);
 *  - listens to agent/pre-step and computes a text description (via a
 *    vision-capable model) for every image-bearing user message; the message
 *    stays as an IMAGE in the conversation history (UI shows the image), while
 *    the model receives the description through a model-visible surface
 *    replacement (session surfaceOp replace + a deriveMessages wrapper);
 *  - listens to tools/post-execute and replaces read_image's image block with
 *    that description before it is committed to session history.
 *
 * Config: registered as the durable settings namespace `dsh-image-vision`
 * (editable in the DSH settings UI under "图片理解", or in settings.yaml).
 * The row `config` in cordis.patch.yml is only a fallback when the settings
 * service is unavailable.
 *
 *   enabled:        boolean  master switch (default true)
 *   patchAdmission: boolean  wrap resolveModelInfo to admit images for
 *                   text-only models (default true)
 *   provider/model: string   optional; pin the vision model. Empty = auto-detect
 *                   the first image-capable provider/model.
 *   prompt:         string   prompt used to describe an image.
 */

const z = require('@deepseek-ai/schemastery')

const DEFAULT_PROMPT =
  '请仔细观察这张图片并详细描述其内容，包括：所有可见的文字（请逐字转录）、物体、人物、场景、布局、颜色以及任何值得注意的细节。请用中文回答。'

const SETTINGS_NS = 'dsh-image-vision'
const configSchema = z.object({
  enabled: z.boolean().default(true),
  patchAdmission: z.boolean().default(true),
  provider: z.string().default(''),
  model: z.string().default(''),
  prompt: z.string().default(DEFAULT_PROMPT),
})

module.exports = {
  name: 'dsh-image-vision',
  inject: ['llm', 'settings'],
  apply(ctx, config = {}) {
    const llm = ctx.llm
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const settings = ctx.settings

    // 持久化配置：注册 settings 命名空间（设置页 / settings.yaml 可编辑）。
    if (settings) {
      try {
        settings.register(SETTINGS_NS, configSchema)
      } catch (e) {
        console.error('[imgvis] settings 命名空间注册失败:', e)
      }
    }

    function currentConfig() {
      if (settings) {
        try {
          const value = settings.get(SETTINGS_NS)
          if (value !== undefined) return value
        } catch (e) {
          /* ignore */
        }
      }
      return {
        enabled: config.enabled !== false,
        patchAdmission: config.patchAdmission !== false,
        provider: typeof config.provider === 'string' ? config.provider : '',
        model: typeof config.model === 'string' ? config.model : '',
        prompt:
          typeof config.prompt === 'string' && config.prompt.length > 0
            ? config.prompt
            : DEFAULT_PROMPT,
      }
    }
    let cfg = currentConfig()

    // Keep the original resolveModelInfo for real-capability checks and restore.
    const originalResolveModelInfo =
      typeof llm.resolveModelInfo === 'function' ? llm.resolveModelInfo : null
    const realResolveModelInfo = originalResolveModelInfo
      ? originalResolveModelInfo.bind(llm)
      : null
    let admissionPatched = false

    function patchAdmission() {
      if (!originalResolveModelInfo || !realResolveModelInfo || admissionPatched) return
      try {
        llm.resolveModelInfo = async function (provider, model, signal) {
          const info = await realResolveModelInfo(provider, model, signal)
          const mods = Array.isArray(info.inputModalities)
            ? info.inputModalities.slice()
            : ['text']
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
      try {
        llm.resolveModelInfo = originalResolveModelInfo
      } catch (e) {
        /* ignore */
      }
      admissionPatched = false
    }
    if (cfg.patchAdmission) patchAdmission()

    // 设置页保存后立即生效（含 patchAdmission 的开关切换）。
    const offSettingsUpdated = settings
      ? ctx.on('settings/updated', (ns) => {
          if (ns !== SETTINGS_NS) return
          const next = currentConfig()
          const prevPatch = cfg.patchAdmission
          cfg = next
          if (next.patchAdmission && !prevPatch) patchAdmission()
          else if (!next.patchAdmission && prevPatch) unpatchAdmission()
        })
      : () => {}

    const modelByAgent = new Map()

    async function findVisionModel() {
      if (cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
      for (const p of llm.listProviders()) {
        try {
          const models = await llm.listModels(p.id)
          for (const m of models) {
            if ((m.inputModalities || []).indexOf('image') !== -1) {
              return { provider: p.id, model: m.id }
            }
          }
        } catch (e) {
          /* ignore */
        }
      }
      return null
    }

    // 候选视觉模型：固定配置的模型优先，再补上所有已配置供应商里支持图片的模型。
    async function visionCandidates(pinned) {
      const list = []
      const seen = new Set()
      const push = (p, m) => {
        const key = p + '/' + m
        if (seen.has(key)) return
        seen.add(key)
        list.push({ provider: p, model: m })
      }
      if (pinned) push(pinned.provider, pinned.model)
      try {
        for (const p of llm.listProviders()) {
          try {
            const models = await llm.listModels(p.id)
            for (const m of models) {
              if ((m.inputModalities || []).indexOf('image') !== -1) push(p.id, m.id)
            }
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
      return list.slice(0, 4)
    }

    // Real multimodal capability, read through the original (unwrapped) method.
    async function supportsImage(provider, model) {
      if (!provider || !model || !realResolveModelInfo) return false
      try {
        const info = await realResolveModelInfo(provider, model)
        return (info.inputModalities || []).indexOf('image') !== -1
      } catch (e) {
        return false
      }
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async function streamDescribe(provider, model, ref) {
      const messages = [
        {
          id: 'imgvis-' + String(Math.random().toString(36).slice(2)),
          role: 'user',
          content: [
            { type: 'text', text: cfg.prompt },
            { type: 'image', attachment: ref },
          ],
          source: { kind: 'user' },
        },
      ]
      let text = ''
      try {
        for await (const chunk of llm.stream({ provider, model, messages })) {
          if (chunk.type === 'text-delta') text += chunk.text
        }
      } catch (e) {
        console.error('[imgvis] 视觉识别失败 (' + provider + '/' + model + '):', e)
        return null
      }
      return text.trim().length > 0 ? text : null
    }

    // 每次发送都重新识别：不跨请求缓存描述。`memo` 仅作用于同一次决策内，
    // 避免同一张图在同一轮里（如用户消息 + read_image 工具结果）被重复识别计费。
    // 失败时依次重试候选视觉模型；全部失败则返回占位描述，绝不让图片裸奔进
    // 纯文本模型（否则适配器会直接报 UNSUPPORTED_CONTENT 使整个回合失败）。
    async function describe(ref, memo) {
      if (memo && memo.has(ref.attachmentId)) return memo.get(ref.attachmentId)
      const vision = await findVisionModel()
      if (!vision) return null
      const candidates = await visionCandidates(vision)
      let text = null
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]
        text = await streamDescribe(c.provider, c.model, ref)
        if (text !== null) break
        if (i + 1 < candidates.length) await delay(600)
      }
      if (text === null) {
        console.error('[imgvis] 所有视觉模型识别失败，使用占位描述')
        text = '（图片内容识别失败，请稍后重试或检查视觉模型配置）'
      }
      if (memo) memo.set(ref.attachmentId, text)
      return text
    }

    // 模型判定优先级（从新到旧）：
    //   1) modelByAgent 缓存：由 system-prompt/assemble 与 agent/request 捕获的
    //      “本次/最近一次请求实际使用的模型”（含会话里 UI 选择的模型，零滞后）；
    //   2) agent.session.requestHeader()：会话最近一次请求头；
    //   3) agent.options：代理级配置；
    //   4) agentDefaultModel：全局默认模型。
    function currentModel(agent) {
      const cached = modelByAgent.get(String(agent && agent.id))
      if (cached) return cached
      try {
        const hdr = agent && agent.session && agent.session.requestHeader()
        const cfg = hdr && hdr.config
        if (cfg && cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
      } catch (e) {
        /* ignore */
      }
      const opts = agent && agent.options
      if (opts && opts.provider && opts.model) return { provider: opts.provider, model: opts.model }
      try {
        const d = agentDefaultModel ? agentDefaultModel.currentSelection() : undefined
        if (d && d.provider && d.model) return { provider: d.provider, model: d.model }
      } catch (e) {
        /* ignore */
      }
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

    async function transformBlocks(blocks, memo) {
      const out = []
      let changed = false
      for (const b of blocks) {
        if (!b) {
          out.push(b)
          continue
        }
        if (b.type === 'image' && b.attachment) {
          const desc = await describe(b.attachment, memo)
          if (desc) {
            out.push({ type: 'text', text: '\n[图片内容描述]\n' + desc + '\n' })
            changed = true
            continue
          }
          out.push(b)
        } else if (b.type === 'tool-result' && Array.isArray(b.content)) {
          const inner = await transformBlocks(b.content, memo)
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

    // 每次 prompt 组装都会在 agent/pre-step 之前执行；这里捕获最终生效的
    // 模型（含用户在会话 UI 中的选择），让 pre-step 的多模态判定零滞后。
    const offAssemble = ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const result = await next()
      try {
        const vars = result && result.variables
        const agent = context && context.agent
        if (vars && vars.provider && vars.model && agent) {
          modelByAgent.set(String(agent.id), { provider: vars.provider, model: vars.model })
        }
      } catch (e) {
        /* ignore */
      }
      return result
    })

    const offRequest = ctx.on('agent/request', async (payload, next) => {
      const requestConfig = await next()
      try {
        if (requestConfig && requestConfig.provider && requestConfig.model) {
          modelByAgent.set(String(payload.agent && payload.agent.id), {
            provider: requestConfig.provider,
            model: requestConfig.model,
          })
        }
      } catch (e) {
        /* ignore */
      }
      return requestConfig
    })

    // 图片消息的“模型可见替换”：pre-step 里预计算好描述文字，等循环把原始
    // 消息（含图片）追加进会话后，再追加一个 surface replace 事件。该替换只
    // 影响模型可见表面（deriveMessages），UI 渲染只认 append 事件、跳过替换
    // 事件 —— 所以对话记录显示图片，模型实际收到的是文字描述。
    //
    // 时序：循环在同步块里追加 user/message 后立刻同步调用 step()，其中的
    // deriveMessages() 会先于任何微任务执行，因此还要包装 session.deriveMessages，
    // 把 pre-step 已算好的描述同步套上（覆盖第一步请求）；持久化替换事件随后
    // 由微任务写入，负责 resume/搜索等场景。
    const pendingReplacements = new Map() // key: `${sessionId}:${messageId}` -> { content }
    const lastTurns = new Map() // agentId -> turn

    function ensureDeriveWrapped(agent) {
      const session = agent && agent.session
      if (!session || typeof session.deriveMessages !== 'function' || session.__imgvisDeriveWrapped) return
      const realDerive = session.deriveMessages.bind(session)
      session.deriveMessages = function () {
        const messages = realDerive()
        let changed = false
        const out = messages.map((m) => {
          if (!m || typeof m.id !== 'string') return m
          const pending = pendingReplacements.get(String(session.id) + ':' + m.id)
          if (!pending) return m
          changed = true
          return Object.assign({}, m, { content: pending.content })
        })
        return changed ? out : messages
      }
      session.__imgvisDeriveWrapped = true
    }

    const offPreStep = ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (!decision || decision.kind !== 'enter') return decision
      if (!cfg.enabled) return decision

      const agent = payload.agent
      ensureDeriveWrapped(agent)
      const cur = currentModel(agent)
      if (cur && (await supportsImage(cur.provider, cur.model))) return decision

      // 新回合清空上一回合遗留的待替换记录（如被中止的回合）。
      const agentId = String(agent && agent.id)
      const turn = payload.turn
      if (lastTurns.get(agentId) !== turn) {
        lastTurns.set(agentId, turn)
        pendingReplacements.clear()
      }

      const sessionId = String(agent && agent.session && agent.session.id)
      const memo = new Map()
      for (const m of decision.messages || []) {
        if (!m || !Array.isArray(m.content) || !hasImageBlock(m.content)) continue
        const transformed = await transformBlocks(m.content, memo)
        if (transformed.changed) {
          pendingReplacements.set(sessionId + ':' + m.id, { content: transformed.blocks })
        }
      }
      // 不修改 decision：图片保留在会话历史里（对话记录显示图片），
      // 模型侧由 deriveMessages 包装 + 持久化替换事件提供文字描述。
      return decision
    })

    const offSessionEvent = ctx.on('session/event', (session, event) => {
      if (!cfg.enabled) return
      if (!event || event.type !== 'user/message') return
      if (event.surfaceOp !== 'append') return
      const data = event.data
      if (!data || typeof data.id !== 'string') return
      const key = String(session && session.id) + ':' + data.id
      const pending = pendingReplacements.get(key)
      if (!pending) return
      pendingReplacements.delete(key)
      const replacement = Object.assign({}, data, { content: pending.content })
      const shadowed = event.seq
      // 不能在 session/event 派发中重入 append；微任务在循环同步块结束后执行。
      // 同步窗口由 deriveMessages 包装兜底，这里落盘持久化替换（resume/搜索）。
      queueMicrotask(() => {
        try {
          session.append('user/message', replacement, {
            surfaceOp: { op: 'replace', start: shadowed, end: shadowed },
            sourceEventSeqs: [shadowed],
          })
          pendingReplacements.delete(key)
        } catch (e) {
          console.error('[imgvis] 写入模型可见替换失败（deriveMessages 包装仍在兜底）:', e)
        }
      })
    })

    const offPostExecute = ctx.on('tools/post-execute', async (exec, result, next) => {
      if (exec.name !== 'read_image') return next()
      const decision = await next()
      if (decision.kind !== 'accept') return decision
      if (result.isError) return decision
      if (!cfg.enabled) return decision

      const cur = currentModel(exec.agent)
      if (cur && (await supportsImage(cur.provider, cur.model))) return decision

      const imageBlock = (result.content || []).find((b) => b && b.type === 'image')
      if (!imageBlock || !imageBlock.attachment) return decision

      const desc = await describe(imageBlock.attachment, new Map())
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

    return () => {
      offAssemble()
      offRequest()
      offPreStep()
      offSessionEvent()
      offPostExecute()
      offSettingsUpdated()
      unpatchAdmission()
    }
  },
}
