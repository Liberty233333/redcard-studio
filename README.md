<p align="center">
  <img src="docs/banner.svg" alt="RedCard Studio — 小红书图文工作台" width="100%">
</p>

<h1 align="center">RedCard Studio</h1>

<p align="center">
  <b>本地优先的小红书图文工作台</b><br>
  把一篇长文，整理成可发布的小红书图文项目：长文 → 文字卡片 → AI 封面 → 导出发布。
</p>

<p align="center">
  <i>From long-form thinking to editorial cards, AI cover, and launch-ready export.</i>
</p>

---

## ✨ 这是什么

RedCard Studio 是一个**纯前端、本地优先**的创作工作台。你把混乱的素材（逐字稿、灵感、播客文稿）丢进去，它帮你按你自己的风格规则，一步步产出一组可直接发布的小红书图文：

- 数据存在浏览器本地（localStorage），不上传服务器
- 调用你自己的 Claude / OpenAI 兼容中转，API Key 只在本地
- 规则、风格、封面语言都沉淀成可复用的知识库

## 🧭 四步工作流

| 步骤 | 做什么 |
| --- | --- |
| **01 长文** | 把原始素材整理成一篇符合账号风格的长文，支持 SPEC 抽取、AI 修改、写作规则注入与 lint |
| **02 文字卡片** | 长文自动分页成 3:4 文字卡片，多主题预览，一键 AI 重排 |
| **03 AI 封面** | 按封面规则（palette × 背景）生成完整 3:4 海报；头像与账号名后处理合成，不进生图 |
| **04 导出发布** | 一键打包封面 + 全部卡片为 ZIP；AI 生成 200 字内短视频发布文案 |

## 🚀 本地运行

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5177/`

### 配置模型

两种方式（任选其一）：

1. **应用内**：右上角齿轮 → 填入文本 / 图片模型的中转地址和 API Key（写入 localStorage）
2. **环境变量**：复制 `.env.example` 为 `.env.local` 并填写

```bash
VITE_LLM_PROVIDER="claude_relay"   # claude_relay（推荐）| claude_direct
VITE_LLM_RELAY_URL=""              # 兼容 Anthropic Messages API 的中转地址
VITE_LLM_API_KEY=""                # claude_direct 必填
VITE_LLM_MODEL="claude-sonnet-4-6"
```

## 🧠 知识库（用你自己的风格）

工具的"风格"由 `docs/knowledge/` 下的可读文档驱动，编译进运行时：

- `style-profile/` — 账号风格、封面语言（palette / 构图 / 铁律）
- `prompts/` — 长文写作技能
- `rules/` — 禁用句式 / AI 腔检测
- `cases/exemplar-articles.md` — few-shot 范文（**公开仓库为空模板，请补充你自己的范文**）

改完源文档后运行 `npm run prebuild` 重新编译。

> 本仓库不附带作者的私有训练样本与第三方参考图（肖像/品牌物料）。这些属于个人素材，请使用你自己的内容。

## 🛠 技术栈

React + TypeScript + Vite ｜ Tailwind ｜ Canvas 后处理 ｜ 纯前端，无后端

## ✅ 验证

```bash
npm run lint     # tsc 类型检查
npm test         # 单元测试
npm run build    # 生产构建
```

## 📄 License

待补充（建议 MIT）。
