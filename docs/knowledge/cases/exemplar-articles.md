# Exemplar Articles（few-shot 训练样本）

> 这里放你自己的范文，作为 few-shot 注入，让 AI 按你的风格整理长文。
> 公开仓库不附带作者的私有样本，请按下面的格式补充你自己的范文。
> 编辑后运行 `npm run prebuild` 重新编译到 `src/llm/_exemplars.generated.ts`。

## 格式说明

每篇范文用 `## Exemplar N`（N 为编号）分隔，内部包含三个小节：

```
## Exemplar <N>

### Source material
（一段原始素材：逐字稿、灵感笔记、播客文稿等）

### Final article
（你按自己的风格整理后的成品长文）

### Tags
内容类型: 人物访谈 / 工具实测 / 观点拆解 ...
风格: 口语化 / 编辑部 / 反共识 ...
```

> 没有任何 `## Exemplar N` 小节时，few-shot 注入为空，工具仍可正常运行（仅少了示例增强）。
