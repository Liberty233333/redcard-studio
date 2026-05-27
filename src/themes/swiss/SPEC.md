# 瑞士网格 / SWISS · NOTES — 主题规范 v1

> 本文件是 swiss 主题的真值（source of truth）。
> 任何渲染细节如与 swiss.css / SwissBodyCard.tsx 冲突，
> 应让代码向本文件收敛。

主题代号: `swiss-grid`
容器: 3:4 恒定（450×600 预览 / 1080×1440 出图）
风格: 米白纸 + 深墨蓝单色调，编辑物 / 印刷物质感

## 颜色

```
--paper:    #F1ECDF
--ink:      #0B0B0E
--sub:      #2A2A30
--accent:   #14264C
--mute:     #6F6F73
--img-bg:   #DDD6C5
```

颜色雷区：不要 #3B5BDB / #4263EB / #1976D2 这类高饱和"网页蓝"，必须 #14264C "钢笔水蓝"。

## 字体

- 中文 + 显示字体: 'Noto Sans SC', system-ui, sans-serif
- meta / 编号 / 英文标签: 'IBM Plex Mono', monospace
- **字重只允许 400 / 900**

## 结构（3:4 恒定）

```
TOPBAR    深墨蓝出血通栏 H≈4%      VOL/N°/日期 反白 mono
HERO      深墨蓝大色块 H≈55%       内嵌图 + 反白 01 + 编辑标签
EDITORIAL 米白纸区 H≈37%           栏目标 + 标题(含 chip) + 短线 + 副标
BOTBAR    米白+顶蓝线 H≈4%         品牌名 / 页码
```

容器内左右 padding 20-24px。顶/底栏、Hero 都出血到容器左右边缘。

## 三种图片比例适配

- Variant A — 16:9 横图 → 图压 hero 顶部、左右出血、深蓝条带在下
- Variant B — 9:16 竖图 → 图贴右出血、深蓝大块在左 + 超大 01
- Variant C — 1:1 方图 → 图贴右出血、深蓝窄条在左 + 竖排 caption

## 深墨蓝必须出现的 9 个位置

1. 顶栏满色块底
2. Hero 大色块底
3. 栏目标文字色
4. 标题 chip（关键词反白印章）
5. 短分割线 28-36px×2px
6. 副标里关键词染色 + 1px 下划线
7. 底栏顶部 1px 细线
8. 底栏右侧 PG. 01 文字色
9. Hero 反白大数字（白字嵌蓝）

## Don't

- 不要纯白 #FFFFFF 背景
- 不要高饱和"网页蓝"
- 不要给整版加边框（出血代替）
- 不要混搭多色标题
- 不要 emoji / 装饰图标
- 不要 chip 圆角 > 2px
- 不要使用 500/600/700 字重
