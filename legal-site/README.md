# OrderMori 官方静态网站

仅含静态 HTML / CSS / 本地 PNG，无框架、无安装步骤、无后端、无表单、无分析或广告脚本。公开联系邮箱由用户指定为 `lenny996@163.com`，不存在占位邮箱。

## 预览与检查

在 OrderMori 仓库根目录执行：

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory legal-site/public
python3 legal-site/verify.py
```

浏览 `http://127.0.0.1:4178/`。本地路径为 `/`、`/privacy/`、`/support/`、`/en/`、`/en/privacy/`、`/en/support/`。英文首页用于同页面语言切换。另有 `404.html`。所有导航均为普通链接，禁用 JavaScript 仍能使用。

## 独立 Vercel 项目

本轮没有部署，也没有猜测域名。人工确认内容后：

1. 在 Vercel 新建 OrderMori 专用 Project，选择本仓库及含网站代码的分支；不要关联其他产品已有 Project。
2. Root Directory 选 `legal-site`，Framework Preset 选 **Other**。不要启用 Include source files outside of the Root Directory。
3. Build Command、Install Command 留空；Output Directory 为 `public`。`vercel.json` 已显式禁用框架／构建／安装并保留目录形式路由。不需要根目录 Expo 的 npm install 或构建。
4. 不启用 Web Analytics、Speed Insights、广告、第三方脚本或联系表单。不要将真实订单、收款图片、备份或环境凭证放入此目录。
5. 初次部署后检查六个页面及图标都返回成功；检查 `/privacy`、`/support` 等重定向到带 `/` 路径；检查 CSP 等响应头。
6. 用于 App Store 的正式地址必须无需 Vercel 登录或部署密码即可访问；预览保护的地址不能作为正式隐私／支持地址。检查目标域名 HTTPS 与 Vercel 实际日志设置。
7. 保持独立项目。生产分支与是否开启 Git 自动部署由用户在 Vercel 设置，本轮没有变更云端设置。不要部署未完成或占位的政策。

只有 `public/` 是部署输出；`README.md`、`AUDIT.md` 和校验脚本在输出目录外，不会作为网站资源发布。`.vercelignore` 另用于减少 CLI 上传资料。正式图标是 `../assets/branding/app-icon.png` 的字节相同副本；未重绘、裁剪或重编码。

## 部署后接入 App

取得真实生产 HTTPS 域名后，修改仓库 `config/release.json`：

- `privacyPolicyUrl`：实际域名的 `/privacy/` 地址。
- `supportUrl`：实际域名的 `/support/` 地址。

`app.config.js` 将它们输出到 `extra.legal`；App 的 `src/ui/PrivacyPolicyLink.tsx` 读取其中的隐私地址。当前 App 没有独立的技术支持按钮；`supportUrl` 是发布配置预留字段，可同时填写 ASC Support URL。英文页面地址可填入 ASC 对应英文元数据，但不擅自改变现有 App 的 URL 选择逻辑。

本轮没有修改上述 App 配置，两项 URL 继续为空。不要把本地预览地址写进正式 App。

## 上线前人工确认

- 核对双语政策、FAQ 与实际发布二进制、权限和 SDK 一致；本文不替代法律合规判断。
- 当前以「OrderMori 开发者」作为发布者称谓，没有猜测公司或真实法律姓名。若需显示法律主体，请由发布者提供并同步双语政策。
- 确认公开邮箱可收信，邮件保留方式与政策一致。
- 确认 Vercel 生产托管／访问日志及供应商处理与政策一致；没有声明日志为零或固定保留天数。
- App Store Privacy 声明应依据实际 App 数据流填写，不能把网站访问日志与 App 业务数据混为一项，也不能因本地处理直接承诺「所有资料绝不离开设备」。

政策日期按香港时间为 2026-10-30。后续修改数据行为时须同步政策、日期和 App Privacy。
