<p align="center">
  <img src="docs/banner.svg" alt="RedCard Studio — 小红书图文工作台" width="100%">
</p>

<h1 align="center">RedCard Studio</h1>

<p align="center">
  <b>写完文章，剩下的交给它</b> —— 一段文字，生成整套小红书图文，<b>越用越像你</b>。
</p>

<p align="center">
  <i>From long-form thinking to editorial cards, AI cover, and launch-ready export.</i><br>
  <i>Local-first · bring-your-own-key.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/本地优先-no_backend-B82828" alt="Local-first">
</p>

---

> ### AI 让人人都能日更，结果发出来全是一个味。
>
> RedCard 反着来——把你的风格、规则、审美沉淀成本地知识库，**越用越像你，而不是越用越像 ChatGPT。**

## 3 秒看懂

把一篇文章（或一段乱素材）丢进去 → 自动生成符合账号语气的**长文**、3:4 **图文卡片**、有杂志质感的 **AI 封面**，外加 **200 字发布文案**；图片 + 文案**一键打包导出**。纯前端、本地优先、用你自己的 API Key。

## 🎬 效果演示

<!-- TODO: 放一张「输入一段文字 → 输出成品图文卡片 + 封面」的截图或 GIF，然后取消下一行注释 -->
<!-- ![RedCard 演示](docs/demo.gif) -->

> 📸 演示截图 / GIF 待补：输入一段文字 → 输出成品卡片 + 封面。

## 适合谁用

- **个人创作者 / 自媒体**：想稳定输出，又不想被 AI 同质化
- **小红书运营**：长文要拆成卡片、要配封面、要写发布文案
- **注重隐私的人**：素材和 API Key 不想上传到别人的服务器

## 🚀 快速开始（3 分钟跑起来）

```bash
git clone https://github.com/Liberty233333/redcard-studio.git
cd redcard-studio
npm install
npm run dev
```

打开 `http://localhost:5177/`，点右上角齿轮填入你的模型中转地址和 API Key，即可开始。

## ✨ 为什么不一样

|  |  |
| --- | --- |
| **省心** | 一段文字，自动出长文、3:4 卡片、封面和发布文案；图片 + 文案一键打包，不用在好几个工具之间来回倒。 |
| **审美在线** | 卡片和封面是编辑部质感——配色、字体、留白、构图照新媒体爆款的视觉语言走，不是模板拼贴、不是廉价 AI 感。 |
| **风格可沉淀** | 你的写作规则、账号语气、封面语言存成可复用的知识库，越用越懂你，而不是每次从头教一遍。 |

## 🧭 四步工作流

| 步骤 | 做什么 |
| --- | --- |
| **01 长文** | 把原始素材整理成符合账号风格的长文，支持 SPEC 抽取、AI 修改、写作规则注入与 lint |
| **02 文字卡片** | 长文自动分页成 3:4 文字卡片，多主题预览，一键 AI 重排 |
| **03 AI 封面** | 按封面规则（palette × 背景）生成完整 3:4 海报；头像与账号名后处理合成，不进生图 |
| **04 导出发布** | 一键打包封面 + 全部卡片为 ZIP；AI 生成 200 字内发布文案 |

## 🧠 知识库（用你自己的风格）

工具的「风格」由 `docs/knowledge/` 下的可读文档驱动，编译进运行时：

- `style-profile/` — 账号风格、封面语言（palette / 构图 / 铁律）
- `prompts/` — 长文写作技能
- `rules/` — 禁用句式 / AI 腔检测
- `cases/exemplar-articles.md` — few-shot 范文（**公开仓库为空模板，请补充你自己的范文**）

改完源文档后运行 `npm run prebuild` 重新编译。

> 本仓库不附带作者的私有训练样本与第三方参考图（肖像 / 品牌物料）。请使用你自己的内容。

## ⚙️ 配置模型

两种方式（任选其一）：

1. **应用内**：右上角齿轮 → 填入文本 / 图片模型的中转地址和 API Key（写入浏览器本地）
2. **环境变量**：复制 `.env.example` 为 `.env.local` 并填写

```bash
VITE_LLM_PROVIDER="claude_relay"   # claude_relay（推荐）| claude_direct
VITE_LLM_RELAY_URL=""              # 兼容 Anthropic Messages API 的中转地址
VITE_LLM_API_KEY=""                # claude_direct 必填
VITE_LLM_MODEL="claude-sonnet-4-6"
```

## 🛠 技术栈

React + TypeScript + Vite ｜ Tailwind ｜ Canvas 后处理 ｜ 纯前端，无后端，本地优先。

## ✅ 开发与验证

```bash
npm run lint     # tsc 类型检查
npm test         # 单元测试
npm run build    # 生产构建
```

## 🔒 隐私

所有项目数据只存在你的浏览器里（IndexedDB / localStorage），不上传服务器；模型调用走你自己的接口，API Key 不出本地。

## 📄 License

待补充（建议 MIT）。
