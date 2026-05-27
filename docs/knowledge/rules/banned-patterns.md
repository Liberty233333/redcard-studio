# Banned Patterns Reference

Machine-readable data source for `src/validators/longformLint.ts`.

Parser: read this file at build time, split into the four categories below, compile to typed registry.

When promoting a new pattern from v2.4 feedback flow, append here with evidence reference.

---

## Category: syntax (regex match against full text)

| Pattern | Max occurrences | Notes |
|---|---:|---|
| `不是.{1,30}而是` | 2 | Contrast construction. Frequency-limited because 1-2 uses can be natural Chinese rhetoric; third and later occurrences count as violations. |
| `不是[^，。？！\n]{1,15}，[^，。？！\n]{1,15}是` | 2 | Contrast variant. 15-char spans keep the match local and avoid catching unrelated clauses; third and later occurrences count as violations. |
| `不是[^，。？！\n]{1,15}，是[^，。？！\n]{1,15}` | 2 | Immediate "不是 A，是 B" contrast variant seen in v2.1 final samples; third and later occurrences count as violations. |
| `——` |  | U+2014 em-dash. Hard ban as punctuation. |
| `(?<!-)--(?!-)` |  | Exactly two consecutive hyphens, hard ban as proxy em-dash. Markdown horizontal rules (`---`, `----`, etc.) are sequences of two or more hyphens and are banned both as em-dash proxies in prose AND as structural separators in Markdown; three-or-more hyphen sequences are captured by the explicit `---+` rule below to avoid duplicate reports. |
| `---+` |  | Markdown horizontal rule or three-or-more hyphen separator. Hard ban as a structural separator; use blank lines or explicit transition words instead. |

## Category: phrase (literal string contains)

These are AI-tell phrases that signal model output rather than human writing.

- 总而言之
- 综上所述
- 在某种意义上
- 众所周知
- 不可否认
- 值得一提的是
- 不难看出
- 从某种程度上来说
- 在一定程度上

## Category: empty-praise (literal string contains)

Empty intensifiers that drain meaning.

- 非常的
- 极其
- 极为
- 堪称
- 颇为

## Category: opening (regex, match against first 50 characters of article body)

Stock-phrase openings.

- `^在当今`
- `^随着.*?的发展`
- `^近年来`
- `^在这个.*?的时代`
- `^众所周知`

---

## Fix instruction generation

For each violation category, the lint produces a fix instruction string for the model's retry prompt. Format:

| Category | Fix instruction template |
|---|---|
| syntax (`不是…而是`) | "避免反复使用 '不是 A' 类对照句，包括 '不是 A 而是 B'、'不是 A，是 B'、'不是 A，B 才是' 以及跨行版本；全篇最多保留 2 次。超出部分改写成下列任一形式：<br>- 'A 不能解决问题，B 才是关键'<br>- 'A 是表面，B 是核心'<br>- '比起 A，B 更重要'<br>- 'A 这个判断错了，真正的判断是 B'<br>- 把对照拆成两句独立说<br>选最贴合上下文的一种重写。" |
| syntax (em-dash) | "删除或改写所有破折号/连字符分隔形态，包括中文长破折号 ——、英文长破折号 —、双连字符 --、三连字符及以上 --- ----（Markdown horizontal rule）。输出禁止使用任何 Markdown horizontal rule 作为段落分隔；段落之间用空行或显式过渡词（如“另外”“接下来”“换个角度看”）替代。" |
| phrase | "删除以下 AI 标签词，用更具体或更口语的表达替换：[列出命中的词]" |
| empty-praise | "删除以下空泛副词或替换为更具体的描述：[列出命中的词]" |
| opening | "重写开头，从一个具体的事实、问题、或场景切入，避免使用套话开篇" |

The lint module concatenates all fix instructions for violations found and feeds the combined prompt back to the model on retry.

---

## How patterns get added here

v2.1 (now): the maintainer curates the initial list.
v2.4 (later): user feedback in the修改意见 box auto-generates Rule Drafts. After a Rule Draft is confirmed active and stable for 5+ generations without new violations, the system proposes promoting it to a banned pattern in this file. Human approves the promotion, file is updated, lint registry recompiles on next build.
