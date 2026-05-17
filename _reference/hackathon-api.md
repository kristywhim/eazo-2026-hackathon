# Hackathon API · v1.0

> **版本**：v1.2
> **更新**：2026-05-15
> **全局前缀**：`/api`
> **鉴权**：本文档下所有接口**默认公开**——无需 `Authorization: Bearer <token>`。客户端带也行，服务端不依赖 user 字段。
> **数据源**：[`EAZO Global Hackathon` Google Sheet](https://docs.google.com/spreadsheets/d/1muwuDscQpacD1Ifbzsl0jwBj16-_HQPHPXRB5Zl1HC4)

聚合 EAZO Global Hackathon 的参赛作品列表。portal 自己持有 Google Sheets API Key，从 sheet 拉数据 → Redis 短缓存 → 用「Eazo Creator registration email」（队长联系邮箱兜底）join 本仓的 `users` + `creator_apps`，让客户端在一次请求里同时拿到「sheet 上的作品信息」「portal 侧实时 app 元信息」「票数」。

> **v1.2 增量（2026-05-15）**
>
> 1. **Sheet 列名重命名**（列序号、DTO 字段不变，组委会调整 Tally 表头中英文化）：
>    - col 7：`Eazo Creator 注册邮箱` → **`Eazo Creator registration email`**
>    - col 9：`您的赛区` → **`Your competition region`**
> 2. **赛区结构拍平为 3 项**：原 6 项（`sf` / `sf_global_online` / `ny` / `sh` / `sh_asia_online` / `all`）变成 4 项（`new_york` / `asia` / `global` / `all`）。客户端契约里**永远只看到 3 个赛区 + 1 个聚合 all**，组委会 sheet 里的 5 个文本选项被 service 内部 normalize 成这 3 个 enum。
> 3. **取消 `cn-only` 可见性**：所有赛区对所有 IP 可见；IP 仅决定**默认值**。

---

## 目录

1. [用户故事](#1-用户故事)
2. [GET /api/v1/hackathon/apps](#2-get-apiv1hackathonapps)
3. [筛选与排序规则](#3-筛选与排序规则)
4. [赛区 (Region) 与 IP 默认规则](#4-赛区-region-与-ip-默认规则)
5. [字段说明](#5-字段说明)
6. [数据流与缓存策略](#6-数据流与缓存策略)
7. [Sheet 列映射](#7-sheet-列映射)
8. [环境变量](#8-环境变量)
9. [代码位置](#9-代码位置)
10. [迁移指南：v1.1 → v1.2](#10-迁移指南v11--v12)

---

## 1. 用户故事

| 用户故事 | 接口 / 参数 |
|---|---|
| 评委 / 观众在 mobile 端浏览本届黑客松全部作品（默认按提交时间倒序）| `GET /api/v1/hackathon/apps` |
| 切换"按票数"排序 | `GET /api/v1/hackathon/apps?sortBy=votes` |
| 在某一赛道下分页查看 | `?category=mobile`（兼容字段：`?track=mobile`）|
| 切到 New York 赛区 | `?region=new_york` |
| 切到 Asia 赛区（Shanghai Offline + Asian Online 合并） | `?region=asia` |
| 切到 Global 赛区（San Francisco + Global Online 合并） | `?region=global` |
| 关键词搜作品 | `?q=hydration` |
| 看每个作品有没有真上线（关联到 `creator_apps.appId`）| `creatorApp` 字段一次性返回 |

> **不在本接口职责内**：作品打分 / 投票 / 评论 / 报名提交。这些走各自单独的接口或直接复用现有 `posts` / `comments` 域。

---

## 2. GET /api/v1/hackathon/apps

### 2.1 业务场景

mobile / web 想拉黑客松作品列表，按赛道 / 赛区过滤、按时间或票数排序、分页展示。**所有 sheet 解析、API key 使用、缓存逻辑都在 portal 完成**，客户端只面对一个干净的 REST + JSON 接口。

### 2.2 HTTP 方法 + 路径 + 认证

- **Method**: `GET`
- **Path**: `/api/v1/hackathon/apps`
- **认证**: **公开**（不强制登录）。带不带 `Authorization` 头都返回 200；服务端**不读** user 字段。

### 2.3 Query 参数

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `page` | int | 否 | `1` | 页码（1-based）|
| `pageSize` | int | 否 | `20` | 每页数量，最大 `100` |
| `sortBy` | enum | 否 | `time` | `time` = 按 `submittedAt` 倒序（默认）；`votes` = 按 `voteCount` 倒序 |
| `category` | string | 否 | — | 分类 / 赛道，substring 匹配，忽略大小写 |
| `track` | string | 否 | — | `category` 的别名（兼容旧客户端，未来移除）|
| `region` | enum | 否 | _按 IP 自动选_ | 见 §4 |
| `q` | string | 否 | — | 关键词搜索，命中 `teamName / appTitle / oneLiner / description` 任一即返回 |
| `refresh` | bool | 否 | `false` | **运维 / 调试用**：绕过 Redis 缓存，强制从 sheet 拉一次最新数据 |

`region` 枚举值（v2）：

| 值 | 展示 label | 含义 / 包含的 sheet 文本选项 |
|---|---|---|
| `all` | All Regions | 不过滤，全部赛区作品都返回 |
| `new_york` | New York | `New York Offline` |
| `asia` | Asia | `Shanghai Offline` + `Asian Online` |
| `global` | Global | `San Francisco` + `Global Online` |

> 5 个 sheet 文本选项 → 3 个对外 enum 的映射在 `HACKATHON_REGION_ALIASES` 集中维护；如果未来组委会新增选项，仅需把新文本追加到对应 enum 的别名数组，**对外契约保持 3 项不变**。

### 2.4 请求示例

```bash
# 默认（按提交时间倒序，IP 决定 region）
curl "$PORTAL/api/v1/hackathon/apps?page=1&pageSize=20"

# 按票数排序 + 仅看 mobile 赛道
curl "$PORTAL/api/v1/hackathon/apps?sortBy=votes&category=mobile"

# 切到 New York 赛区
curl "$PORTAL/api/v1/hackathon/apps?region=new_york"

# 切到 Asia 赛区（合并 Shanghai Offline + Asian Online）
curl "$PORTAL/api/v1/hackathon/apps?region=asia"

# 切到 Global 赛区（合并 San Francisco + Global Online）
curl "$PORTAL/api/v1/hackathon/apps?region=global"

# 关键词搜索
curl "$PORTAL/api/v1/hackathon/apps?q=hydration"

# 强制刷新缓存（运维）
curl "$PORTAL/api/v1/hackathon/apps?refresh=true"
```

### 2.5 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 42,
    "page": 1,
    "pageSize": 20,
    "hasMore": true,
    "fetchedAt": 1747234567890,
    "cached": true,
    "appliedRegion": "global",
    "detectedCountryCode": "US",
    "availableRegions": [
      { "id": "new_york", "label": "New York", "parentId": null },
      { "id": "asia",     "label": "Asia",     "parentId": null },
      { "id": "global",   "label": "Global",   "parentId": null }
    ],
    "hubDeadlines": [
      { "hub": "new_york", "submission": "2026-05-24T21:00:00Z", "voting": "2026-05-25T01:00:00Z" },
      { "hub": "asia",     "submission": "2026-05-23T23:00:00Z", "voting": "2026-05-24T11:30:00Z" },
      { "hub": "global",   "submission": "2026-05-24T04:00:00Z", "voting": "2026-05-24T17:00:00Z" }
    ],
    "list": [
      {
        "submissionId": "gN7vJk1q",
        "submittedAt": "2026-05-14T08:21:00Z",
        "teamName": "Team Eazo",
        "track": "Best Mobile App",
        "region": "San Francisco",
        "hub": "global",
        "teamSize": 3,
        "members": [
          { "name": "张三", "email": "zhangsan@example.com", "role": "Frontend" },
          { "name": "李四", "email": "lisi@example.com", "role": "Backend" },
          { "name": "王五", "email": "wangwu@example.com", "role": "Designer" }
        ],
        "appTitle": "Hydration Tracker",
        "oneLiner": "Stay hydrated, stay productive.",
        "appUrl": "https://hydration.example.app",
        "description": "## 灵感来源\n…",
        "coverUrl": "https://cdn.eazo.ai/hackathon/cover.png",
        "voteCount": 124,
        "creatorApp": {
          "appId": "i294365497988747264",
          "title": "Hydration Tracker",
          "icon": "https://cdn.eazo.ai/icons/hydration.png",
          "status": "finished",
          "isPublished": true,
          "visibility": "public"
        }
      }
    ]
  }
}
```

### 2.6 状态码

| 状态 | 含义 |
|---|---|
| 200 | 查询成功；`data.list` 可能为空数组（sheet 中无数据 / 过滤后为空）|
| 400 | `pageSize` 越界、`region` / `sortBy` 不在枚举内等参数校验失败 |
| 500 | sheet API key 未配置 / sheet HTTP 失败 |

> **不返回 401**：本接口公开，匿名访问也是 200。

---

## 3. 筛选与排序规则

### 3.1 排序（`sortBy`）

| 值 | 行为 |
|---|---|
| `time`（默认）| 按 `submittedAt` 字符串解析为时间戳后倒序；解析失败按 `0` 处理（最末尾）|
| `votes` | 按 `voteCount` 倒序；同票回退到 `submittedAt` 倒序兜底 |

> **`voteCount` 当前的语义**：取关联到的 `creator_apps.like_num`。如果某个作品没有匹配到 `users`/`creator_apps`（参赛者用了不同邮箱注册或还没建 app），voteCount = 0。后续如果上线"黑客松专属投票表"，service 层只需要换数据源即可，DTO 不变。

### 3.2 分类过滤（`category` / `track`）

二者同义；**`track` 是兼容字段**，未来会移除。两个都传时优先用 `category`。匹配方式是 substring，忽略大小写，命中 `track` 列任一字符即过滤通过。

### 3.3 关键词搜索（`q`）

把 `teamName` + `appTitle` + `oneLiner` + `description` 拼成一个 haystack，再做 substring + 忽略大小写匹配。**不**做分词、tokenize、拼音转英、模糊距离 — 这是黑客松一次性活动，不值得维护一个搜索索引。

### 3.4 赛区过滤

见 [§4](#4-赛区-region-与-ip-默认规则)。

### 3.5 提交截止时间过滤（自动生效）

每个赛区有自己的「作品提交截止」时刻（UTC）：

| 赛区 | 包含的 sheet 选项 | 提交截止 (UTC) | 全部投票截止 (UTC) |
|---|---|---|---|
| `asia` | Shanghai Offline / Asian Online | 2026-05-23T23:00:00Z（5月24日 07:00 CST）| 2026-05-24T11:30:00Z（5月24日 19:30 CST）|
| `global` | San Francisco / Global Online | 2026-05-24T04:00:00Z（5月23日 21:00 PT）| 2026-05-24T17:00:00Z（5月24日 10:00 PT）|
| `new_york` | New York Offline | 2026-05-24T21:00:00Z（5月24日 17:00 ET）| 2026-05-25T01:00:00Z（5月24日 21:00 ET）|

**服务端行为**：

1. 解码每行时按 `region` 文本识别所属赛区，写入 `hub` 字段（取值 `new_york` / `asia` / `global`）。
2. 列表过滤阶段，对每条作品比较 `submittedAt` 与所属赛区的 submission UTC 截止时间，**严格大于**视为逾期，从结果剔除。
3. `submittedAt` 缺失 / 解析失败 / 赛区无法识别（参赛者填了组委会未列出的别名）→ **不过滤**，避免脏数据误伤。
4. 完整三赛区截止时间通过响应顶层 `hubDeadlines` 一次性下发，客户端据此显示倒计时 / 投票按钮可用性，**不需要硬编码这三个时刻**。

> 截止时间常量集中在 `src/modules/hackathon/dto/hackathon-region.enum.ts` 的 `HACKATHON_HUB_DEADLINES`；如果组委会临时调整时间，只需要改这一处。

---

## 4. 赛区 (Region) 与 IP 默认规则

### 4.1 默认值（按 IP 国家码）

服务端用 `GeoService.lookupIpSimple()` 拿到调用方 IP 的 ISO 国家码，按下表选默认值：

| 国家码 | 默认 `appliedRegion` |
|---|---|
| `CN` / `HK` / `TW` / `MO` / `JP` / `KR` / `SG` | `asia` |
| `US` | `global` |
| 其它 / IP 解析失败 | `all`（不过滤）|

> 这些只是首屏默认；客户端任何时候传 `region` query 参数都会覆盖默认。

### 4.2 可见性

**v2 起所有赛区对所有 IP 可见**（取消了原 `sh` / `sh_asia_online` 的 cn-only 限制）。`availableRegions` 永远返回全部三个赛区——前端可以放心地把它当成下拉选项原样渲染。

### 4.3 Sheet 中 `region` 列的对齐

sheet 第 9 列「Your competition region」是参赛者从下拉选的字符串，组委会预置了 5 个选项；service 维护一张别名表把这 5 个文本映射到 3 个 enum：

```ts
{
  new_york: ['new york offline'],
  asia:     ['shanghai offline', 'asian online'],
  global:   ['san francisco', 'global online'],
}
```

匹配方式是 substring + 忽略大小写。命中任一别名即认为属于该赛区。

> **维护提示**：如果组委会新增或调整 sheet 选项，**只改 alias 表**，不要拆出新的 enum 项——客户端契约里赛区永远是 3 个 + 聚合 `all`。

### 4.4 跨赛区的语义

- `region=all` 不应用赛区过滤。
- 其它赛区都是**包含式**——例如 `region=asia` 既包含 sheet 上填 `Shanghai Offline` 的作品，也包含填 `Asian Online` 的作品。
- 不再有"父子赛区"概念（v2 已扁平化）。

---

## 5. 字段说明

### 5.1 顶层 `data`

| 字段 | 类型 | 说明 |
|---|---|---|
| `total` | int | 过滤之后的总数（不是 sheet 里全量行数）|
| `page` / `pageSize` | int | 回显请求 |
| `hasMore` | bool | 是否还有下一页 |
| `fetchedAt` | int(ms) | sheet 数据 **最近一次成功落 Redis 的时间戳**。客户端可据此提示"x 分钟前更新" |
| `cached` | bool | 本次响应是否命中 Redis 缓存。冷启 / `refresh=true` 时为 `false` |
| `appliedRegion` | enum | 本次实际生效的 region（参考 §4）|
| `availableRegions` | array | 当前可见的 region 选项（v2 起永远是 3 个 + 聚合无需返回，前端下拉用）|
| `detectedCountryCode` | string\|null | ISO 3166-1 alpha-2 国家码；无法识别时 null |
| `hubDeadlines` | `HubDeadline[]` | 三大赛区的提交 / 投票截止时间（UTC, ISO 8601）。**服务端已用 `submission` 截止过滤了 `list`**，逾期作品不会出现；客户端可据此显示倒计时 / 控制投票按钮。参考 §3.5 |
| `list` | `HackathonAppItem[]` | 当页作品列表 |

### 5.2 `HackathonAppItem`

| 字段 | 类型 | 说明 |
|---|---|---|
| `submissionId` | string | 来自 Tally 的 `Submission ID`，可作为前端列表 key |
| `submittedAt` | string\|null | sheet 中的提交时间（ISO 8601）|
| `teamName` | string\|null | 队伍名称 |
| `track` | string\|null | 参赛赛道（即 `category` 字段在 sheet 里的原值）|
| `region` | string\|null | sheet 中参赛者填的赛区**原文**，如 `"San Francisco"` / `"Asian Online"`（**不是** `appliedRegion`）|
| `hub` | enum\|null | 服务端从 `region` 文本解析出的赛区 enum（`new_york` / `asia` / `global`）；无法识别时为 null（这种行不会被截止时间过滤）|
| `teamSize` | int\|null | 团队人数 |
| `members` | `HackathonAppMember[]` | 队长 + 队员 2 + 队员 3，最多 3 人，按 sheet 列顺序；空成员行被忽略 |
| `appTitle` | string\|null | 作品名称（sheet 上选填，可能空）|
| `oneLiner` | string\|null | 一句话描述 |
| `appUrl` | string\|null | 作品 URL（外部入口）|
| `description` | string\|null | 详细介绍补充（长文本，原样保留 markdown）|
| `coverUrl` | string\|null | 作品封面 |
| `voteCount` | int | 票数（当前实现：取关联的 `creator_apps.like_num`）|
| `creatorApp` | `HackathonAppCreatorApp \| null` | 见下；按「Eazo Creator registration email（col 7）→ 队长联系邮箱（col 13）」回退链匹配 `users` + `creator_apps`；都没命中则为 `null` |

### 5.3 `HackathonAppMember`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string\|null | 姓名 |
| `email` | string\|null | 邮箱 |
| `role` | string\|null | 主要职责 |

> 仅在三个字段全空时跳过该 member 行。客户端展示时建议至少要求 `name || email` 才渲染。

### 5.4 `HackathonAppCreatorApp`

| 字段 | 类型 | 说明 |
|---|---|---|
| `appId` | string | `creator_apps.app_id`，可直接用于 `GET /api/v1/apps/:id` 等接口 |
| `title` | string | App 当前标题（可能与 `appTitle` 不同；`creator_apps.title` 是实时值）|
| `icon` | string\|null | App icon URL |
| `status` | string | `creator_apps.status` — `draft` / `processing` / `manual_reviewing` / `finished` / `rejected` / `archived` / `failed` |
| `isPublished` | bool | 是否已上架（feed 召回的旧 flag）|
| `visibility` | string | `public` / `private` / `draft` |

> 关联规则（**邮箱回退链**）：
>
> 1. **优先**：sheet col 7「Eazo Creator registration email」（v1.2 起重命名；原 "Eazo Creator 注册邮箱"），这是参赛者**显式声明**的关联键
> 2. **兜底**：sheet col 13「队长联系邮箱」，应对参赛者 col 7 没填或填错的情况
>
> 命中任一邮箱即视为关联成功；找到的 `userId` 之后，在 `creator_apps` 上取 `is_deleted=false` 的最近一条（`updated_at DESC`）。**两列邮箱原文都不返回给客户端**（隐私）。

---

## 6. 数据流与缓存策略

```
[客户端] ──GET──> [portal-agent-server]
                       │
                       ├─ 抽 IP → GeoService → countryCode → 计算默认 region
                       │
                       ├─ Redis hit?  ─yes─> decode 全量 → 全量 enrich creator_apps
                       │                    → filter (category/region/q)
                       │                    → sort (time/votes)
                       │                    → page
                       │
                       └─ Redis miss / refresh=true
                              │
                              v
                  [Google Sheets API v4]
                  https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}?key=…
                              │
                              v
                  [写 Redis] (TTL 5 分钟)
                              │
                              v
                  decode + enrich + filter + sort + page
```

- **Sheet 范围**：`'工作表1'!A1:AD`（30 列覆盖完整表头 + 行数据）
- **缓存键**：`hackathon:apps:sheet:v1`
- **TTL**：300 秒（5 分钟）
- **`refresh=true`**：跳过 Redis 读，但**仍会**回写缓存。供运维在 sheet 刚改完想验证时使用
- **enrich 在分页前做**：因为 `sortBy=votes` 需要全量 voteCount。当前 sheet 量级（百行级）单次扫表 + 一次 IN 查询完全可控；如未来量级超过数千行，可对 `sortBy=time` 走 page-only enrich 的 fast-path
- **错误处理**：
  - sheet API 失败 → 抛 `500`
  - Redis 读写失败 → 仅 `logger.warn`，**不阻塞**主流程
  - GeoService 失败 → `detectedCountryCode = null`，`appliedRegion` 退化到 `all`

---

## 7. Sheet 列映射

> 当前 sheet（`EAZO Global Hackathon`，工作表1）共 30 列。portal 把列下标常量化在 `hackathon.service.ts: COL`。**未来 sheet 结构变化只需要改这里 + DTO**，不应该污染 controller 层。

| 列号 (0-based) | Header（v1.2 起）| 旧 Header（v1.1） | DTO 字段 |
|---|---|---|---|
| 0  | Submission ID | （未变）| `submissionId` |
| 1  | Respondent ID | （未变）| （不返回）|
| 2  | Submitted at | （未变）| `submittedAt` |
| 3  | Submission PDF | （未变）| （不返回）|
| 4  | Submission preview | （未变）| （不返回）|
| 5  | 请选择您的操作 | （未变）| （不返回）|
| 6  | 队伍名称 | （未变）| `teamName` |
| 7  | **Eazo Creator registration email** | Eazo Creator 注册邮箱 | （不返回；**关联 `users.email` 的主键** —— 见 §5.4 邮箱回退链）|
| 8  | 请选择您的参赛赛道 | （未变）| `track` |
| 9  | **Your competition region** | 您的赛区 | `region`（原文，对外返回）+ `hub`（enum，service 解析）|
| 10 | 团队人数 | （未变）| `teamSize` |
| 11 | 队长姓名 | （未变）| `members[0].name` |
| 12 | 队长联系电话 | （未变）| （不返回）|
| 13 | 队长联系邮箱 | （未变）| `members[0].email`（同时是 col 7 没匹配上时的关联兜底键）|
| 14 | 你的主要职责 | （未变）| `members[0].role` |
| 15 | 队员 2 · 姓名 | （未变）| `members[1].name` |
| 16 | 队员 2 · 邮箱 | （未变）| `members[1].email` |
| 17 | 队员 2 · 主要职责 | （未变）| `members[1].role` |
| 18 | 队员 3 · 姓名 | （未变）| `members[2].name` |
| 19 | 队员 3 · 邮箱 | （未变）| `members[2].email` |
| 20 | 队员 3 · 主要职责 | （未变）| `members[2].role` |
| 21 | 作品名称（选填）| （未变）| `appTitle` |
| 22 | 一句话描述您的作品 | （未变）| `oneLiner` |
| 23 | 作品 URL | （未变）| `appUrl` |
| 24 | 我的作品详细介绍补充 | （未变）| `description` |
| 25 | 作品封面 | （未变）| `coverUrl` |
| 26-29 | 行为守则确认 / 留言 | （未变）| （不返回）|

> **注意**：表头文案改了，**列序号没变**——portal 不依赖 header 文本，纯按列索引解析；上面的"Header"列只是给运维 / 设计同学对照 sheet 时用。

---

## 8. 环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `HACKATHON_SHEETS_API_KEY` | **是** | Google Sheets API key（read-only 权限即可）。portal 启动时若没有该值，第一次请求会抛 `500` |
| `GOOGLE_SHEETS_API_KEY` | 否 | fallback：当 `HACKATHON_SHEETS_API_KEY` 没设时使用。两个变量都没设则报错 |
| `HACKATHON_SHEET_ID` | 否 | 可覆盖默认 sheet ID（`1muwuDscQpacD1Ifbzsl0jwBj16-_HQPHPXRB5Zl1HC4`）|

`.env` 示例：

```env
HACKATHON_SHEETS_API_KEY=AIzaSy...
# HACKATHON_SHEET_ID=1muwuDscQpacD1Ifbzsl0jwBj16-_HQPHPXRB5Zl1HC4
```

---

## 9. 代码位置

| 项 | 路径 |
|---|---|
| Module | `src/modules/hackathon/hackathon.module.ts` |
| Controller | `src/modules/hackathon/hackathon.controller.ts` → `HackathonController.listApps` |
| Service | `src/modules/hackathon/hackathon.service.ts` → `HackathonService.listApps` |
| Sheet 列映射 | 同上 — `COL` 常量 |
| Region / Sort 枚举 | `src/modules/hackathon/dto/hackathon-region.enum.ts` |
| Query DTO | `src/modules/hackathon/dto/list-hackathon-apps.dto.ts` |
| Response DTO | `src/modules/hackathon/dto/hackathon-app.dto.ts` |
| 关联表 | PostgreSQL `users` + `creator_apps` |
| IP → 国家 | `src/modules/geo/geo.service.ts: lookupIpSimple` + `src/common/utils/ip.util.ts: extractClientIp` |

---

## 10. 迁移指南：v1.1 → v1.2

| 维度 | v1.1 | v1.2（当前）|
|---|---|---|
| col 7 sheet header | `Eazo Creator 注册邮箱` | **`Eazo Creator registration email`** |
| col 9 sheet header | `您的赛区` | **`Your competition region`** |
| `region` enum 取值 | `all` / `sf` / `sf_global_online` / `ny` / `sh` / `sh_asia_online` | **`all` / `new_york` / `asia` / `global`** |
| 父子 region 结构 | `sf_global_online` 父=`sf`；`sh_asia_online` 父=`sh` | **取消父子关系**（全部 `parentId = null`）|
| `cn-only` 可见性 | `sh` / `sh_asia_online` 仅对 CN IP 可见 | **取消**——所有赛区对所有 IP 可见 |
| `hub` 字段取值 | `sh` / `sf` / `ny` | **`new_york` / `asia` / `global`** |
| `hubDeadlines[].hub` | 同上 | 同上 |
| sheet 列序号 / DTO 字段 | — | **不变** |
| API 路径 / 鉴权 / 状态码 | — | **不变** |

### 客户端迁移步骤

1. **更新 `region` 枚举常量**：把客户端硬编码的 `sf` / `sf_global_online` / `ny` / `sh` / `sh_asia_online` 替换为 `new_york` / `asia` / `global`：
   - `sf`、`sf_global_online` → `global`
   - `ny` → `new_york`
   - `sh`、`sh_asia_online` → `asia`
2. **下拉选项渲染**：直接用响应里的 `availableRegions`（永远 3 项），不要再依赖 `parentId` 做层级——它现在永远是 `null`。
3. **`hub` 字段消费**：把展示 / 倒计时逻辑里对 `sh` / `sf` / `ny` 的判断改成对 `asia` / `global` / `new_york` 的判断。
4. **不要依赖 sheet header 文本**：portal 已经把 col 7 / col 9 的 header 改名了，但客户端从来都不接触 header（只看 DTO），无需改动。

---

*文档版本：v1.0 / 接口版本 v1.2；与 portal-agent-server `feat/hackathon` 分支并维护。*
