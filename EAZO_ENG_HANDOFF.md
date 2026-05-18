# Eazo 黑客松 2026 · 工程对接文档

**致**：Eazo 产品 & 工程团队
**自**：黑客松运营
**最近更新**：2026-05-17

---

## 一句话概览

我们为这次黑客松做了**一整套独立的投票 + 评分 + 颁奖系统**。代码、数据库（Supabase）、托管都在我们这边，跟 Eazo 的现有系统**完全解耦**——我们只通过 2 个对接点拿你们的数据（**用户身份** + **作品详情**），其余全部自己搞定。

---

## 5 个页面

| 页面 | 链接 | 谁用 |
|---|---|---|
| 公众投票 | `/vote` | 所有观众，嵌入 Eazo App WebView |
| 选手互评 | `/peer-vote` | 参赛队员，嵌入 Eazo App WebView |
| 直播大屏 | `/onair` | 现场大屏投影 |
| 评委打分 | `/judge?hub=sf&code=XXX` | 评委手机访问 |
| Finalist 颁奖后台 | `/finalist` | 主持人 + 运营，颁奖时打开 |

---

## 已经完成的功能

### 🎤 公众投票（`/vote`）+ 选手互评（`/peer-vote`）

- 按 **3 大赛区**展示标签：🇺🇸 SF（含 Global Online）· 🗽 NY · 🇨🇳 SH（含 Asia Online）
- **以"作品（app）"为单位**显示卡片——一个队提交多个作品时分别展示
- 点卡片打开详情弹窗：作品标题、描述、track 标签、票数、"打开作品"按钮（跳转到 Eazo Creator 上的作品 URL）
- **公众投票**：每人每赛区 10 票，可以分给同一作品也可以分给多个
- **互评投票**：每人 3 票，**不能投自己所在队伍任何作品**，截止时间自动锁定，且只能提交一次

### 👨‍⚖️ 评委打分（`/judge`）

- 严格按你们的「Judge Guide 2026」5 个维度评分：
  - 01 产品完整度 · 02 创新性 · 03 技术深度（Eazo Creator 使用质量）· 04 设计体验 · 05 商业潜力
  - 每项 0–10 分，**满分 50**
- 评委用专属 code 登录（每个赛区一组 code，例如 `JUDGE_SF_01`）
- 一个队伍如果有多个作品进 Demo，分别打分，最后取该队所有作品评分的**平均**作为这个队的 J 分

### 📺 直播大屏（`/onair`）

- 3 个赛区独立板面，可切换查看
- 实时刷新作品票数排名，自动滚动
- 前 3 名 podium 高亮（金 / 银 / 铜）
- 右侧 sidebar 显示实时统计（队伍数、作品数、累积投票数）+ 最近 submission feed

### 🏆 Finalist 颁奖后台（`/finalist`）

**这是为了颁奖夜准备的**——投票截止那一刻，主持人打开就能看到**实时综合得分排名**，不需要任何人工统计。

- **综合得分公式**（按 prize-logic-v4）：
  > 综合分 = 用户投票 × 50% + 评委 × 40% + 互评 × 10%
  > （各项在区内做 min-max 归一化避免量纲差异）
- 3 个赛区**并排展示**，每区显示 Top 12 + 综合分 + 金银铜标识
- 点任一赛区可进入详细视图：完整 30 强 + V/J/P 数值拆解 + 综合分进度条
- **B 类特别奖板块**：单独区块显示符合条件的队伍——任意一个作品 > 200 公众票、但没进 Demo（每队 $1,000 奖金候选）
- 每 30 秒自动刷新

### ⏰ 时间集中管理

所有提交截止和投票截止时间放在 **一个文件** `api/_deadlines.js` 里。前端页面加载时通过 `GET /api/deadlines` 接口拉，组委会改时间只需改一处全站同步。

当前时间表（按你们 5/16 更新的版本）：

| 赛区 | 作品提交截止 | 投票截止 |
|---|---|---|
| 🇨🇳 SH（含 Asia Online）| 5/24 07:00 CST | 5/24 19:30 CST |
| 🇺🇸 SF（含 Global Online）| 5/23 21:00 PT | 5/24 10:00 AM PT |
| 🗽 NY | 5/24 17:00 ET | 5/24 21:00 ET |

### 🎨 品牌统一

5 个页面 logo 设计、字体、色板都按你们 Figma 调一致：
- DM Sans 字体、Eazo 橙 `#FF6B20`、奶白 `#F8ECD3`
- Logo mark：浅色页面用橙底 + 奶白 6 瓣星；深色页面用奶白底 + 橙星（贴近 Figma 原版）
- 全站 SVG 自定义的星形 mark，不依赖系统字体

---

## 重要的数据模型

**1 个队伍可以提交多个作品**（按主办方要求）。所有投票、评分都以"作品"为单位。但晋级时按"队伍"——一个队不管多少作品入围 Top 10，**只占 1 个 Demo 名额**，下一名的队伍递补。

队伍维度的分数 = 该队所有作品里**最高的那个**（不是总和；避免"多提交几个作品就有优势"）。

特别奖资格 = 队伍任意一个作品 > 200 公众票 **且**该队没进 Demo。

---

## 我们还需要 Eazo 团队提供的 2 个东西

只剩这两件事。不给我们就上不了线。

### 1. 用户登录 token（WebView 注入）

**为什么必须**：公众投票要按用户控制 10 票 / 区的额度；互评要排除自己所在队伍；都需要知道"谁在投"。

**我们这边怎么对接**：Eazo App 在 WebView 加载前注入用户身份。我们灵活适配以下任一方式：

```js
// 方式 A：注入全局变量
window.EAZO_TOKEN = "JWT 串";
// 方式 B：注入函数调用
window.receiveAuthToken("JWT 串");
// 方式 C：postMessage
parent.postMessage({type:'eazo_token', token:'JWT 串'}, '*');
```

**token 解码后我们需要的字段**：
- `user_id` — 用户唯一标识
- `team_id` — 用户所在队伍 ID（用于互评排除自己队）
- `region` — 用户所在赛区（`new_york` / `asia` / `global`，自动选标签）

**请告诉我们**：
1. token 格式（JWT? 算法 RS256/HS256?）
2. 验签密钥（公钥 / shared secret）
3. payload 里实际字段名（是 `sub` 还是 `user_id`?）
4. 注入方式（A/B/C 哪种）

> 💡 如果暂时没有正式 JWT 桥，最简单的方式：直接注入 `window.EAZO_USER = { userId, teamId, region }` 明文对象。我们先这样跑，等你们 JWT 上线再加验签。

---

### 2. 作品详情数据接口（`GET /api/v1/hackathon/apps`）

**为什么必须**：报名表（我们读的 Google Sheet）里**只有队伍名单**，没有作品标题 / URL / 描述 / 封面。作品本身在 Eazo Creator 里——必须通过你们的 portal 接口拿。

你们之前共享的 `hackathon-api.md` 文档定义了这个接口（按邮箱 join 报名表 + creator_apps，返回作品详情）。

**请告诉我们**：
1. 接口的**部署 URL** —— 你们文档里写的 `$PORTAL` 实际是什么？
2. **预计上线时间** —— 没有它的话，前端"打开作品"按钮一直显示 "coming soon"
3. **一个边界问题**：报名了但还没在 Eazo Creator 建作品的队伍，接口会返回这些队伍吗（`creatorApp: null`）？还是直接过滤掉？

> 💡 注意：你们 v1.2 文档里提到的 `sortBy=votes`（按 `creator_apps.like_num` 排序）这个用户故事我们**不用**——黑客松的投票数在我们自己的数据库里，不是 Eazo Creator 的 likes。

---

## 部署

- **代码**: `github.com/kristywhim/eazo-2026-hackathon`
- **托管**: Vercel
- **数据库**: Supabase（独立项目，跟你们的 Postgres 没关系）

环境变量：

```bash
# 已经在用
SUPABASE_URL=https://...                 # 我们 Supabase
SUPABASE_SERVICE_ROLE_KEY=...
EAZO_SHEETS_API_KEY=AIzaSy...            # Google Sheets API key（读报名表）
EAZO_SHEET_ID=1W7VBHzbeHyxGaIIg_UonmZgCVbZpoZ5x20PvlWvG8kE
ADMIN_SECRET=HACKATHON_ADMIN_2026

# 等 Item 1、Item 2 给我们后加
EAZO_JWT_SECRET=...                      # token 验签 key
EAZO_PORTAL_BASE=https://...             # portal 接口的 base URL
```

---

## 时间紧迫程度

| 待办事项 | 我们等到什么时候 | 为什么 |
|---|---|---|
| 用户登录 token（Item 1）| **越快越好** | 没它公众投票和互评都上不了线 |
| Portal 接口部署 URL（Item 2）| 报名截止前 | 没它作品详情显示不出来，只显示队伍名 |

---

## 代码结构 · 文件指引

| 用途 | 路径 |
|---|---|
| 数据库 schema | `supabase/schema.sql` |
| 历次迁移（按顺序跑）| `supabase/migrations/001..006_*.sql` |
| 集中的截止时间配置 | `api/_deadlines.js` + 公开接口 `api/deadlines.js` |
| 报名表同步 | `api/sync-teams.js`（读 Tally 报名 sheet）|
| 公众投票 API | `api/vote.js`、`api/projects.js`、`api/leaderboard.js` |
| 互评 API | `api/peer-vote.js` |
| 评委打分 API | `api/judge-score.js` |
| Finalist + 综合得分 API | `api/finalists.js`、`api/award-ranking.js` |
| 特别奖 API | `api/special-awards.js` |
| 用户身份验证（**Item 1 待办**）| `api/_auth.js` |
| Eazo portal 命名翻译表 | `api/_eazo_portal_mapping.js` |
| 5 个前端页面 | `eazo-comm-votepage/`、`eazo-peer-votepage/`、`eazo-onair/`、`eazo-judgescorer/`、`eazo-finalist/` |
| Eazo 提供的参考文档 | `_reference/hackathon-api.md`、`_reference/eazo_2026_judge_guide_en.md`、`_reference/prize-logic-v4.html`、`_reference/1778987515256.jpg` |

---

## 历史变更要点（给翻历史的人看）

- **2026-05-17**：apps 数据模型重构（1 队 N 作品）；区域投票额度（10 票 / 区，不再 10 票 / hub）；C/D 类线上晋级公式按 prize-logic 修复；B 类特别奖完整实现；品牌 logo 全站统一
- **2026-05-16**：评委 5 维度评分系统上线；公众 + 互评 + onair 三大页面合并为 3 个赛区；项目详情弹窗；Finalist 颁奖后台重做（综合得分实时排名）
- **2026-05-15**：截止时间集中到 `api/_deadlines.js`，前端通过 API 拉
- **2026-05-13**：响应式布局、品牌色统一
- **2026-05-12**：搜索框、自动补全

---

## 有问题？

代码全在 `github.com/kristywhim/eazo-2026-hackathon`。任何问题、想要的接口调整、bug 反馈，直接联系运营或在 repo 开 issue。
