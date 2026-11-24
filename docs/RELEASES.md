# OrderMori 发布记录

## 1.1.0

状态：发布配置已确认。候选版本为 **1.1.0 (Build 2)**。用户已核对 App Store Connect 和 EAS 构建记录，确认 Build 2 未被使用。功能源码基线为 `490eb883647f2c1e5f51a30affc882bcfd7c1480`。

### App Store「此版本的新功能」

**繁體中文（香港）**

- 新增 AlipayHK 支付寶香港及 WeChat Pay HK 微信支付香港。可匯入商家自行取得的官方收款碼，並選填收款人名稱。
- 兩款付款通知模板均支援以繁體中文或英文顯示新增收款方式。
- 加強備份還原的資料檢查及歷史訂單的永久財務鎖保護。

**English**

- Added AlipayHK and WeChat Pay HK. Import an official collection QR code from your payment provider and add a payee name if you wish.
- Both payment notice templates support the new methods in Traditional Chinese and English.
- Improved backup restore checks and protection for permanently locked historical orders.

### 资料兼容性与验收

- 五种收款方式均向 Free 与 Pro 开放。Free 额度及 Lifetime Pro 权益沿用现有规则。
- SQLite v11 向前兼容 v10；归档继续使用 Manifest v1。1.1.0 可导入合法的 1.0.0 v10 ZIP。1.0.0 会拒绝超出其支持范围的 v11 备份。
- Phase 1E-R1／R1V／R2：**CLOSED WITH ACCEPTED TEST GAP**。产品发布决策接受完整缺锁 v10/v11 ZIP 专项验证未执行的风险。已通过的证据包括真实缺锁 SQLite 校验、活跃数据库的财务写入防御、完整财务锁时间不一致 ZIP 拒绝，以及合法 v10/v11 ZIP 恢复。异常订单保留历史查看，受保护的编辑和状态操作被拒绝。主机测试使用真实 SQLite 和 ZIP，iOS 原生验收另列。
- Phase 1C 模拟器：用户确认 10/10 通过。Phase 2A 原生设备：用户确认 18/18 通过，包括原位升级、两种新增收款方式、八组 PNG 输出与扫码、动态字体与图片比例、相簿和分享、v10 导入与 v11 导出恢复、异常备份拒绝、重启持久化、财务锁、Free 与 Lifetime Pro。目前无法从可获取记录将这次验收与具体构建 ID 或源码 SHA 绑定。
- Apple Review 提交门槛：用正式 TestFlight 候选构建完成原生验收，再记录实际 Git SHA、EAS Build ID、App Version、iOS Build Number 和验收结论。
- App 内隐私与支援沿用四个已配置的 HTTPS 地址。1.1.0 双语站点计划于 2026-11-24 公开（香港时间）；若实际部署日期变化，须同步更新两份隐私政策的最近更新日期。

## 1.0.0

iOS 已发布，Build 1。`v1.0.0` 指向 `8683649feac6a52eb776384ac2e01e7cd9e77376`。发布版的 SQLite Schema 为 v10，备份格式为 Manifest v1。
