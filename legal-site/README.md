# OrderMori 官方静态网站

仅含静态 HTML / CSS / 本地 PNG，无框架、无安装步骤、无后端、无表单、无分析或广告脚本。公开联系邮箱由用户指定为 `lenny996@163.com`，不存在占位邮箱。

## 预览与检查

在 OrderMori 仓库根目录执行：

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory legal-site/public
python3 legal-site/verify.py
```

浏览 `http://127.0.0.1:4178/`。本地路径为 `/`、`/privacy/`、`/support/`、`/en/`、`/en/privacy/`、`/en/support/`。英文首页用于同页面语言切换。另有 `404.html`。所有导航均为普通链接，禁用 JavaScript 仍能使用。

## 发布到既有 Vercel 项目

生产项目为 `homeypaw/ordermori-site`，域名为 `ordermori-site.vercel.app`。静态项目使用 `public` 输出，无需安装或构建 Expo。

1. 在两份隐私政策页首保留首次生效日期，另填相同的实际公开更新日（香港时间）。实际发布日期改变时同步修改两页。
2. 确认本机 `legal-site` 已连接 `homeypaw/ordermori-site`，并检查预览。若本机尚未连接，进入 `legal-site` 后运行 `npx vercel link --scope homeypaw --project ordermori-site`，并确认选中已有项目。
3. 从仓库根目录执行以下命令发布。生产域名的隐私和支持页面应无需登录；发布后核对中英文四个链接、更新日及政策实际内容。

```sh
python3 legal-site/verify.py
npx vercel deploy --cwd legal-site --scope homeypaw --prod
```

只有 `public/` 是部署输出；`README.md`、`AUDIT.md` 和校验脚本在输出目录外，不会作为网站资源发布。`.vercelignore` 另用于减少 CLI 上传资料。正式图标是 `../assets/branding/app-icon.png` 的字节相同副本；未重绘、裁剪或重编码。

## App 与商店链接

`config/release.json` 的四个 HTTPS 地址通过 `app.config.js` 输出至 `extra.legal`。「我的店舖」的隐私及技术支持入口根据当前界面语言打开同一生产站点上的对应页面。App Store Connect 使用同一组地址。详见[发布与验收记录](../docs/RELEASES.md)。

## 上线前人工确认

- 核对双语政策、FAQ 与实际发布二进制、权限和 SDK 一致；本文不替代法律合规判断。
- 当前以「OrderMori 开发者」作为发布者称谓，没有猜测公司或真实法律姓名。若需显示法律主体，请由发布者提供并同步双语政策。
- 确认公开邮箱可收信，邮件保留方式与政策一致。
- 确认 Vercel 生产托管／访问日志及供应商处理与政策一致；没有声明日志为零或固定保留天数。
- App Store Privacy 声明应依据实际 App 数据流填写，不能把网站访问日志与 App 业务数据混为一项，也不能因本地处理直接承诺「所有资料绝不离开设备」。

政策首次生效日为 2026-10-30。后续修改数据行为时须同步政策、实际公开更新日和 App Privacy 核对结果。
