# OrderMori

面向香港及未來國際市場的小型商家訂單管理和付款通知工具。

- **技術方向：** React Native + Expo + TypeScript
- **架構原則：** Local-First、Offline-First、盡量無自建後端
- **目標語言：** English + 繁體中文（香港）
- **目前狀態：** iOS 1.0.0（Build 1）已發布

品牌與工程命名規範請參閱 [OrderMori 品牌基線 v1](./ORDERMORI_BRAND_BASELINE_v1.md)。

## 本機啟動

日常開發使用 `develop`。專案使用 Expo 58、React Native 0.88 和 React 19.3。
使用符合 `package.json` 的 Node.js 版本，EAS Production 採用 22.13.0。

```sh
npm ci
npm run ios:device
```

連接並信任 iPhone，啟用 Developer Mode，從 Expo 提示選擇裝置，並確認 Xcode 使用自己的簽名 Team。
已安裝 Development Build 後，只修改 JavaScript 時可執行 `npm start`。

## 本機 iOS 簽名

在 `config/signing.local.json` 填寫自己的 `appleTeamId`，格式為 10 位大寫英數字。
如需沿用已確認的本機導出合規聲明，可加入 `usesNonExemptEncryption` 布林值。
Expo 會在讀取 App 配置時載入此選用檔案。Git 忽略此檔案，請另外備份並只保存在本機。
新工作區可從備份還原該檔案至相同位置。EAS Production 的公開發布設定見 `eas.json` 與 `config/release.json`。

## 產品概要

- 在「訂單」管理本機訂單、草稿、搜尋、篩選與待辦。
- 在「我的店舖」設定收款方式、常用商品、語言與備份。
- 可生成與分享付款通知 PNG。免費版每月可新增 15 張訂單，Pro 提供無限訂單與去除 PNG 品牌署名。
- 款項與履約狀態由商家確認。備份與使用方式見[技術支援](https://ordermori-site.vercel.app/support/)。

## 檢查與驗收

```sh
npm run typecheck
npm run lint
npm test
npm run check:expo
```

自動測試使用 Node SQLite 與合成資料，涵蓋 Migration、建單、月度額度、狀態鎖定、備份還原及其他回歸場景。
手動驗收可從「我的店舖」設定店舖資料，建立訂單後重啟 App 確認資料仍在，再核對收款、糾錯與履約流程。
