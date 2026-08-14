window.__ModuleLoader__.load({
  id: 'dsh-image-vision',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    const inject = ['slots', 'connection', 'remote'];

    const SETTINGS_NS = 'dsh-image-vision';

    function apply(ctx) {
      const api = ctx.connection.api;

      const selStyle = {
        width: '100%', padding: '8px 10px', borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit',
      };
      const taStyle = Object.assign({}, selStyle, { minHeight: 96, resize: 'vertical' });
      const btnStyle = {
        boxSizing: 'border-box', height: 36, font: 'inherit', cursor: 'pointer',
        border: 'none', borderRadius: 18, justifyContent: 'center', alignItems: 'center',
        padding: '0 14px', fontSize: 14, lineHeight: '22px', display: 'inline-flex',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
      };

      function Field(props) {
        return React.createElement('div', { style: { marginBottom: 18 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 7 } }, props.label),
          props.children,
          props.hint ? React.createElement('div', { style: { fontSize: 12, opacity: 0.55, marginTop: 5 } }, props.hint) : null,
        );
      }

      function Section() {
        const [meta, setMeta] = React.useState(null);
        const [draft, setDraft] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [saved, setSaved] = React.useState(false);
        const [missing, setMissing] = React.useState(false);

        function load() {
          Promise.all([
            api.settings.describe({}),
            api.llm.providers({}),
            api.llm.models({}),
          ]).then(([sRes, pRes, mRes]) => {
            const view = sRes.result.ok
              ? (sRes.result.value.namespaces || []).find((n) => n.ns === SETTINGS_NS)
              : undefined;
            if (!view) { setMissing(true); return; }
            const value = view.value || {};
            setMeta({
              revision: view.revision,
              writable: sRes.result.value.writable !== false,
              providers: pRes.result.ok ? pRes.result.value.providers : [],
              groups: mRes.result.ok ? mRes.result.value.groups : [],
            });
            setDraft({
              enabled: value.enabled !== false,
              patchAdmission: value.patchAdmission !== false,
              provider: typeof value.provider === 'string' ? value.provider : '',
              model: typeof value.model === 'string' ? value.model : '',
              prompt: typeof value.prompt === 'string' ? value.prompt : '',
            });
          }).catch(() => { setMissing(true); });
        }

        React.useEffect(() => {
          load();
          const off = ctx.remote.$on('settings/document-updated', (ns) => {
            if (ns === SETTINGS_NS) load();
          });
          return off;
        }, []);

        async function save() {
          if (!draft || !meta) return;
          setBusy(true);
          setSaved(false);
          try {
            const ops = [
              { op: 'set', path: ['enabled'], value: !!draft.enabled },
              { op: 'set', path: ['patchAdmission'], value: !!draft.patchAdmission },
              { op: 'set', path: ['provider'], value: draft.provider },
              { op: 'set', path: ['model'], value: draft.model },
              { op: 'set', path: ['prompt'], value: draft.prompt },
            ];
            const res = await api.settings.mutate({
              ns: SETTINGS_NS,
              ops,
              expectedRevision: meta.revision,
            });
            if (res.result.ok) {
              setMeta((m) => (m ? Object.assign({}, m, { revision: res.result.value.revision }) : m));
              setSaved(true);
              load();
            }
          } finally {
            setBusy(false);
          }
        }

        if (missing) {
          return React.createElement('div', null, '未找到 dsh-image-vision 设置命名空间：它尚未加入 DSH 的 settings 暴露白名单。请运行仓库中的 install 脚本（含 apiproxy 补丁）后重启 DSH。');
        }
        if (!draft || !meta) {
          return React.createElement('div', { style: { fontSize: 13, opacity: 0.6 } }, '加载中…');
        }

        // 只列出当前已配置（active）的供应商；若已保存的供应商已停用，仍保留该选项以免状态丢失。
        const allProviders = meta.providers || [];
        const providers = allProviders.filter((p) => p.active);
        const savedProvider = draft.provider && !providers.some((p) => p.provider === draft.provider)
          ? allProviders.find((p) => p.provider === draft.provider) || null
          : null;
        const providerOptions = savedProvider ? [savedProvider].concat(providers) : providers;
        const selectedGroup = (meta.groups || []).find((g) => g.id === draft.provider);
        const models = selectedGroup ? selectedGroup.models : [];

        return React.createElement('div', { style: { maxWidth: 560 } },
          React.createElement(Field, { label: '启用图片理解', hint: '当模型不支持图片时，自动用视觉模型生成文字描述代替图片' },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
              React.createElement('input', { type: 'checkbox', checked: draft.enabled, onChange: (e) => setDraft(Object.assign({}, draft, { enabled: e.target.checked })) }),
              '拦截图片并替换为文字描述',
            ),
          ),
          React.createElement(Field, { label: '允许向纯文本模型发送图片', hint: '绕过发送时的“当前模型不支持图片”拦截，以及 read_image 工具的门禁' },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
              React.createElement('input', { type: 'checkbox', checked: draft.patchAdmission, onChange: (e) => setDraft(Object.assign({}, draft, { patchAdmission: e.target.checked })) }),
              '放行图片（自动识别为文字）',
            ),
          ),
          React.createElement(Field, { label: '识别图片的模型', hint: '留空 = 自动探测第一个支持图片的模型；手动选择时请选择支持图片的模型' },
            React.createElement('select', { value: draft.provider, style: selStyle, onChange: (e) => setDraft(Object.assign({}, draft, { provider: e.target.value, model: '' })) },
              React.createElement('option', { value: '' }, '自动检测'),
              providerOptions.map((p) => React.createElement('option', { key: p.provider, value: p.provider }, p.displayName + ' (' + p.provider + ')')),
            ),
            React.createElement('div', { style: { marginTop: 8 } },
              React.createElement('select', { value: draft.model, style: selStyle, onChange: (e) => setDraft(Object.assign({}, draft, { model: e.target.value })) },
                React.createElement('option', { value: '' }, '该供应商自动选择'),
                models.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.name + ' (' + m.id + ')')),
              ),
            ),
          ),
          React.createElement(Field, { label: '描述提示词' },
            React.createElement('textarea', { value: draft.prompt, style: taStyle, onChange: (e) => setDraft(Object.assign({}, draft, { prompt: e.target.value })) }),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 } },
            React.createElement('button', {
              onClick: save, disabled: busy || !meta.writable,
              style: Object.assign({}, btnStyle, { opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }),
            }, busy ? '保存中…' : '保存'),
            saved ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, '已保存') : null,
          ),
        );
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'image-vision',
        order: 30,
        label: '图片理解',
      }, Section));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
