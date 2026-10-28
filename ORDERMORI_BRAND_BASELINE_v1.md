# OrderMori — Brand & Repository Naming Baseline v1.0

- 日期：2026-10-28
- 产品：原 QuickReceipt HK（香港小店開單助手）
- 当前结论：**采用 OrderMori 作为首选品牌及工程命名基线；App Store Connect 占名、商标、域名及 GitHub 用户名下的仓库创建仍待最终确认。**
- 当前阶段：Phase 0（规划及技术验证）；**未开始完整 App 代码开发**。

## 1. 公开核查记录

| 项目 | 初步结果 | 状态 |
| --- | --- | --- |
| “OrderMori” 完整品牌词网页检索 | 未找到明确的完全同名品牌 | 初步有利；非商标保证 |
| App Store 公开索引 | 未找到明确的 OrderMori 完全同名 App | 待 App Store Connect 验证 |
| Google Play 公开索引 | 未找到明确的 OrderMori 完全同名 App | 非 Google Play 正式占名验证 |
| GitHub 公开检索 | 未找到明确的同名项目；目标仓库在账号名下需单独创建 | 待账号内确认 |
| 香港商标 / WIPO / 美国商标 | 官方入口可访问，但未完成注册簿的精确及近似查询 | 待核查 |
| ordermori.com / ordermori.app | 未取得权威的实时 RDAP / 注册商查询结果 | 状态未知 |

重要：单独的 “Mori” 已有其他 App、品牌及产品使用，不能以“完整词未搜到”推断无混淆或商标冲突。建议至少查询 `OrderMori`、`Order Mori`、`OrderMory`、近似发音及可能相关的软件类别，必要时咨询商标专业人士。

## 2. 品牌规范

| 用途 | 固定写法 |
| --- | --- |
| 正式英文品牌 | `OrderMori` |
| 中文产品说明（不是第二品牌） | `小店開單助手` |
| 原项目名 | `QuickReceipt HK`（仅作为规划历史提及） |
| 英文 Slogan（候选） | `Simple orders. Clear payments.` |
| 繁体中文 Slogan（候选） | `開單快一步，收款更清楚。` |
| App 图标 / 启动画面 | 使用 `OrderMori`，不使用 `OrderMori HK` |
| iOS 主屏幕短名称 | `OrderMori` |

统一大小写：对外展示 `OrderMori`，代码标识、目录、包名使用小写 `ordermori`；不要混用 `Ordermori`、`Order Mori`、`QuickReceipt`。

## 3. App Store 元数据（拟定）

| 配置 | English (U.S.) / en-US | Chinese (Traditional) / zh-Hant |
| --- | --- | --- |
| App Name | `OrderMori - Order Maker` | `OrderMori - 小店開單助手` |
| Subtitle | `Create & Share Payment Notes` | `快速開單・付款通知・訂單管理` |
| 品牌名 | `OrderMori` | `OrderMori` |
| 主屏幕显示 | `OrderMori` | `OrderMori` |

- 建议 App Store **Primary Language = English (U.S.)**。
- 同时添加 **Chinese (Traditional)** 的名称、描述、关键词和副标题。
- **App 内语言**：默认可依据设备语言使用 `en` / `zh-HK`；非中文界面回退英文，提供语言切换或遵循系统语言。请注意：App Store 元数据的 `zh-Hant` 与 App 内港式繁体文案的 `zh-HK` 是不同层次。
- 1.0 可以全球上架，但业务支持仍以香港（HKD、PayMe、FPS、顺丰等）为先。**全球可下载不等于适配世界各国支付及多币种**；商店描述须说明功能支持范围。
- 上述名称/副标题均满足 Apple 的 30 字符上限，但需 Apple 后台最终占名校验。

## 4. 工程与发布标识

| 项目 | 建议值 | 备注 |
| --- | --- | --- |
| 本地文件夹 | `~/Desktop/project/ordermori` | 仅示例；Codex 在用户 Mac 上创建 |
| GitHub Repository | `ordermori` | 账号命名空间下检查；建议初期私有仓库 |
| GitHub URL | `https://github.com/<account>/ordermori` | `<account>` 待实际账号替换 |
| Expo app `name` | `OrderMori` | 主屏幕显示名 |
| Expo `slug` | `ordermori` | 与仓库统一 |
| npm `package.json` name | `ordermori` | 小写 |
| iOS Bundle ID | `com.zhushunli.ordermori` | **建议**，使用前确认与 Apple Developer Team 的现有命名空间一致且可注册 |
| Expo `scheme` | `ordermori` | 仅在确需深链时配置；避免空做功能 |
| App Store SKU | `ORDERMORI-IOS-001` | 创建时确定；不可更改 |
| Expo / EAS owner | 用户当前 Expo 账号 | 不凭猜测填账号 |
| App Store IAP product ID | 暂不冻结 | 待技术设计与 App Store Connect 配置时确定 |
| 版本起点 | Planning v0.1 / PRD v1.0 / App 0.1.0 开发期 | 不把文档版本与 App 发布版本混淆 |

**iOS Bundle ID 在首次上传构建后不能再改**；请在首个 EAS / TestFlight 上传之前完成确认。GitHub 仓库名可以在以后更改，但建议不要无意义地频繁变更。

## 5. Git 与目录原则

- 仓库初期建议使用 `main`（稳定基线）+ `develop`（集成开发）；明显的单独功能使用短命的 `feature/<scope>` 分支。**不做复杂 Git Flow 审批流程**。若想进一步精简，首个技术 Spike 期间只用 `main` 也可以。
- `.gitignore` 忽略 `.env*`（若有）、私钥、签名材料、凭证、编译产物；提供 `.env.example`（若确实有变量），绝不提交 Apple 私钥或服务账号密钥。
- `docs/` 保存 PRD / 技术设计 / 任务清单 / 发布清单；`assets/` 保存静态资源；`app/` 用于 Expo Router 页面；`src/` 只按实际功能拆分，避免提前设计庞大目录。
- 用户订单数据、SQLite 实例、商家 Logo 或收款码样本（除脱敏测试素材）不进入 Git。
- HomeyPaw 继续完全独立；不复制其 Supabase、业务 Schema 或功能代码。

### 建议初始目录（仅文档基线，尚非完整工程）

```text
ordermori/
├── README.md
├── .gitignore
└── docs/
    ├── PRD.md
    └── BRAND_BASELINE.md
```

真正初始化 Expo 时再创建 `app/`、`src/`、`assets/` 等需要的目录，不预建空文件夹。

## 6. 创建前必须完成的检查（Gate）

1. **Apple Developer / App Store Connect**：确认可选用 Bundle ID `com.zhushunli.ordermori`；新建 iOS App 记录，主语言 English (U.S.)，尝试使用 `OrderMori - Order Maker`；然后加入 Chinese (Traditional) 并验证 `OrderMori - 小店開單助手`。失败时记录实际占名错误，不做无意义的前后缀堆砌。
2. **商标**：香港 IPD e-Search、WIPO Global Brand Database 及计划投放地区的国家商标系统检索 exact/near marks；不能将普通网页搜不到视为商标不存在。
3. **域名**：用有权威注册数据的 RDAP / 注册商查询 `ordermori.com`、`ordermori.app`；若不可用，不阻塞早期本地技术 Spike，但正式外部品牌传播前需要选定实际支持和隐私政策网址。
4. **GitHub**：登录拥有权限的目标账号，检查 `ordermori` 仓库名并优先选择 Private；仅首次创建时进行初始化 commit/push，其后遵循用户确认的提交策略。

## 7. Codex 初始化范围（获得 Gate 通过后）

仅允许：
- 在用户 Mac 的 `~/Desktop/project/ordermori` 建独立工作目录；如已存在则先检查，禁止覆盖。
- 初始化新的 Git 仓库，使用 `ordermori` 命名；建立简洁的 README、.gitignore、docs，并复制已确认的 PRD 与本命名基线。
- 账户权限允许且用户授权时创建 **private** GitHub 仓库 `ordermori` 并执行首次 push；不擅自公开。
- 若开展 Phase 0 技术 Spike，先明确范围；**此步不实现完整订单、SQLite、付费或 App UI**。
- 结束时汇报目录、Git 分支、远端 URL、commit、检查结果及未完成 Gate。

禁止：复制 HomeyPaw 产品代码、添加 Supabase、自行开展完整 App 开发、提交密钥、使用假造的 Apple/GitHub/Expo 账号信息、声称已通过未实际执行的平台检查。

## 8. 官方参考入口

- Apple 命名与创建 App：https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/
- Apple App 信息：https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- Apple 本地化：https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/
- Expo app config：https://docs.expo.dev/versions/latest/config/app/
- Expo localization：https://docs.expo.dev/guides/localization/
- 香港知识产权署：https://www.ipd.gov.hk/en/online-services/online-search/index.html
- WIPO 商标：https://www.wipo.int/en/web/global-brand-database
- 美国 USPTO：https://tmsearch.uspto.gov/search/
- ICANN 注册数据：https://lookup.icann.org/en

> 本文件记录产品与工程建议，不构成法律意见，不代表已在 Apple、GitHub、域名注册商或官方商标系统成功预约或注册任何名称。
