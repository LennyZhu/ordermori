# 数据流审计记录 — 2026-10-30

范围：当前工作区 OrderMori 1.0（含已人工验收、尚未提交的 Phase 4D），只读审查实现与依赖；没有运行购买、数据库恢复、模拟器或真机。不是对未知二进制网络行为的动态认证。

| 声明 | 代码证据与文案边界 |
| --- | --- |
| 本地 SQLite／文件 | `src/data/native.ts`、`migrations.ts`、`store.ts`、`mediaRoot.ts`；店铺、商品、订单、状态、额度及媒体在本地。`src/i18n/react.tsx` 的设备语言偏好使用独立 SQLite KV。 |
| 没有订单自动上传 | 扫描正式 `app/`、`src/`：没有业务 fetch/axios/WebSocket 上传路径；依赖与配置未加入分析、广告、崩溃上传、账号或订单同步后端。只作当前实现声明，不承诺设备／平台永不联网。 |
| 官方收款图片 | `paymentFiles.ts`、`qrCopy.ts`：系统选图、PNG/JPEG 检查、原字节持久复制与哈希；不生成支付码。商家确认不等于 App 官方验证账户或到账。 |
| 照片与分享 | `noticeExportNative.ts`：主动操作时请求 iOS add-only 权限并用 Asset.create 保存；分享本地 PNG。`domain/noticeExport.ts` 保留资格校验且不误报发送成功。 |
| 未加密 ZIP 备份 | `backupNative.ts`、`backup/archive.ts`、`backup/fileNames.ts`：SQLite Online Backup、媒体、Manifest／哈希、ZIP；`.ordermori.zip` 与旧 `.ordermori` 兼容，用户通过系统面板导出。SHA-256 不是加密或来源认证。 |
| 替换恢复 | 恢复前校验和确认；`backup/data.ts` 的 replaceData 及恢复目录切换不做业务合并。用户取消不改数据；月度已知记录不回退，语言偏好不随业务包覆盖。 |
| Apple IAP | `proNative.ts`、`domain/pro.ts`、`storeProof.ts`：expo-iap 6.3.0／StoreKit 当前已验证交易；无 RevenueCat／IAPKit Key／自建服务器；不从备份导入 Pro。操作涉及 Apple 商品与交易服务，不能承诺全部离线或永不传出。 |
| 日志 | App 的 PNG／Schema 阶段日志受 __DEV__ 限制。`expo-iap/ios/ExpoIapLog.swift` 在非 DEBUG 默认关闭，敏感字段有脱敏；未配置远端回报。系统诊断依 iOS 用户设置，不能保证所有平台零日志。 |
| 删除的实际能力 | `deleteProduct`、`removeSavedNotice` 可移除商品／本机 PNG。没有 deleteOrder 或一键清库入口；取消／退款保留历史。移除 QR 设置可能保留历史所需原图，安全恢复可能保留旧媒体。政策没有虚构立即物理抹除。 |
| 草稿与额度 | `store.ts` 一份活动草稿，草稿不计数；`domain/quota.ts` 为香港自然月 15 单。无并行多草稿界面，FAQ 明示这一点。 |
| 网站与邮件 | 新网站没有 JS、远端字体、表单或 Cookie 存储；邮件是用户主动 mailto。Vercel 与邮箱供应商仍可能处理 IP／请求日志或邮件，未臆测零日志、具体保存天数或处理地区。 |

官方资料（已检查）：
- Apple App Privacy：https://developer.apple.com/app-store/app-privacy-details/
- Apple Privacy：https://www.apple.com/legal/privacy/
- Vercel Privacy Notice：https://vercel.com/legal/privacy-notice
- Vercel 静态配置：https://vercel.com/docs/project-configuration/vercel-json

双语逐节映射：privacy 的 scope/local/network/permissions/exports/apple/retention/email/website/changes；support 的 start/free/pro/restore-purchase/backup/notices/payments/paid/delete。中英文保持相同事实、限制与联系邮箱。人工仍需确认法律主体、邮件实际保留与最终 Vercel 部署设置。
