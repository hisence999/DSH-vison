'use strict'

/**
 * dsh-image-vision — DSH host-composition plugin.
 *
 * Gives text-only models the ability to "see" images:
 *  - wraps llm.resolveModelInfo so text-only models pass the send admission
 *    and the read_image route gate (images get admitted instead of rejected);
 *  - listens to agent/pre-step and replaces image blocks (top-level and inside
 *    tool results) with a text description produced by a vision-capable model;
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
  inject: ['llm'],
  apply(ctx, config = {}) {
    const llm = ctx.llm
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const settings = ctx.get('settings')

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

    const descriptions = new Map()
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

    async function describe(ref) {
      if (descriptions.has(ref.attachmentId)) return descriptions.get(ref.attachmentId)
      const vision = await findVisionModel()
      if (!vision) return null
      const messages = [
        {
          id: 'imgvis-' + String(descriptions.size),
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
        for await (const chunk of llm.stream({
          provider: vision.provider,
          model: vision.model,
          messages,
        })) {
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

    async function transformBlocks(blocks) {
      const out = []
      let changed = false
      for (const b of blocks) {
        if (!b) {
          out.push(b)
          continue
        }
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

    const offPreStep = ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (!decision || decision.kind !== 'enter') return decision
      if (!cfg.enabled) return decision

      const agent = payload.agent
      const cur = currentModel(agent)
      if (cur && (await supportsImage(cur.provider, cur.model))) return decision

      const messages = decision.messages || []
      let found = false
      for (const m of messages) {
        if (m && Array.isArray(m.content) && hasImageBlock(m.content)) {
          found = true
          break
        }
      }
      if (!found) return decision

      const out = []
      for (const m of messages) {
        const blocks = m && Array.isArray(m.content) ? m.content : []
        const transformed = await transformBlocks(blocks)
        if (transformed.changed) {
          out.push({ id: m.id, role: m.role, content: transformed.blocks, source: m.source })
        } else {
          out.push(m)
        }
      }
      return { kind: 'enter', messages: out }
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

    return () => {
      offRequest()
      offPreStep()
      offPostExecute()
      offSettingsUpdated()
      unpatchAdmission()
    }
  },
}
