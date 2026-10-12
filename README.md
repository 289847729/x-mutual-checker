<div align="center">

# 𝕏 Mutual Follow Checker
### X（原 Twitter）互关筛查助手

**一键筛查单向取关与未回关好友，数据纯本地安全计算，零第三方依赖，零封号风险**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20%7C%20Tampermonkey-orange.svg)]()
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local%20Only-success.svg)]()
[![Version](https://img.shields.io/badge/Version-1.4.1-brightgreen.svg)]()

[功能特点](#-项目功能) • [安装使用说明](#-安装与使用指南) • [常见问题排查](#-常见问题排查-faq) • [工作原理](#-工作原理与安全性) • [开源协议](#-开源协议)

</div>

---

## 📖 项目简介

在 X（Twitter）社交网络中，经常会遇到以下困扰：
- 关注了别人很久，却不知道对方是否早已悄悄取关；
- 想要整理关注列表，手动一个一个核对互关状态极为费时费力；
- 市面上的第三方查互关工具通常要求授权应用权限、输入账号密码或上传 Cookie 到陌生服务器，存在极高的**泄密**与**封号**风险。

**𝕏 Mutual Follow Checker** 专为解决这一问题而生。它直接以**油猴脚本**或**浏览器扩展**的形式运行在你的浏览器前端，直接复用当前 X 官方会话，在本地完成好友关系链比对。

> **🔒 隐私承诺**：没有任何后端服务器，不收集、不上报任何账号数据或 Cookie，所有操作与数据仅留存于您自己的浏览器内存中。

---

## ✨ 项目功能

- 🔴 **未回关我（单向关注）**：精确列出「我关注了对方，但对方没有回关我」的账号。
- 🟢 **双向互关**：清晰展示彼此互相关注的好友列表。
- 🔵 **粉丝待回关**：快速查看关注了我、但我尚未回关的粉丝。
- ⚡ **快速取关与主页直达**：在列表内支持一键跳转个人主页，对未回关人员可一键操作取关。
- 🔍 **实时搜索过滤**：支持按用户昵称、@用户名或简介关键字实时搜索筛选。
- 📥 **一键导出 CSV**：支持将筛选名单一键导出为 Excel 友好的 CSV 文件（UTF-8 BOM 编码，双击不乱码），便于备份存档。
- 🛡️ **智能频控重试**：内置自适应限速与 429 频控重试机制，防止触发 X 平台风控。

---

## 🖼️ 效果预览

![扫描结果预览](docs/screenshots/scan-result-redacted.png)
*(注：上图展示了扫描统计、分类标签切换、搜索框及操作按钮，示例中账号已做脱敏处理)*

---

## 🚀 安装与使用指南

本项目提供三种使用方式，**强烈推荐使用方式一（油猴脚本）**，安装最轻便、更新最简单。

### 方式一：Tampermonkey 油猴脚本（推荐，最省心）

#### 步骤 1：安装 Tampermonkey（篡改猴）插件
若浏览器已安装可跳过此步：
- **Chrome 浏览器**：前往 [Chrome 应用商店安装 Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Edge 浏览器**：前往 [Edge 外接程序安装 Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

> ⚠️ **Chrome 新版重要设置（必看）**：
> 如果安装后点击插件提示 *“篡改猴没有访问此页面的权限”* 或脚本未生效，请按以下步骤开启权限：
> 1. 打开 Chrome 地址栏输入 `chrome://extensions/` 进入扩展管理页面；
> 2. 找到 **Tampermonkey**，点击「**详细信息**」；
> 3. 向下滚动找到「**允许用户脚本 (Allow user scripts)**」或打开右上角的「**开发者模式**」，将开关设为开启。

#### 步骤 2：安装筛查脚本
1. 点击浏览器右上角 Tampermonkey 图标，选择「**管理面板**」（Dashboard）；
2. 点击右上角的「**+**」号（添加新脚本）；
3. 清空编辑框中原有的默认代码；
4. 打开项目根目录中的 [`x-mutual-checker.user.js`](./x-mutual-checker.user.js)，**全选复制**全部代码并粘贴到编辑框中；
5. 按快捷键 `Ctrl + S`（Mac 为 `Cmd + S`）保存脚本。

#### 步骤 3：开始使用
1. 打开并登录 [x.com](https://x.com) 网页版；
2. 刷新页面，页面右下角将出现蓝色的「**互关筛查 v1.4.1**」悬浮胶囊按钮；
3. 点击胶囊展开面板，点击右上角「**🚀 开始扫描**」；
4. 扫描完成后，即可自由查看、搜索或一键导出 CSV。

---

### 方式二：Chrome / Edge 本地扩展加载（无需油猴）

如果你不想安装油猴插件，可以直接把本项目当作浏览器扩展加载：

1. 将本项目下载或克隆到本地电脑；
2. 打开浏览器扩展管理页面：
   - Chrome：在地址栏访问 `chrome://extensions/`
   - Edge：在地址栏访问 `edge://extensions/`
3. 打开页面右上角（或左下角）的「**开发者模式 (Developer mode)**」开关；
4. 点击「**加载已解压的扩展程序 (Load unpacked)**」；
5. 在弹出的文件选择器中，选择本项目的 [`extension`](./extension) 文件夹；
6. 打开或刷新 [x.com](https://x.com)，即可在右下角看到互关筛查工具。

---

### 方式三：Python 命令行版（开发者备用）

为习惯终端或离线批处理的开发者准备了纯 Python 标准库实现的 CLI 工具（无需 `pip install` 任何额外库）：

```bash
# 运行脚本
python3 x_checker.py
```

运行后根据提示输入浏览器的 `auth_token` 与 `ct0`（从浏览器 F12 Application -> Cookies 中获取），脚本将自动执行并导出 `x_not_following_back_*.csv`。

> ⚠️ **特别提示**：Cookie 属于极为私密的敏感凭证，**绝不要**将其提交至公共仓库、不要泄露给他人。普通用户请务必使用方式一或方式二。

---

## ❓ 常见问题排查 (FAQ)

### Q1: 打开 X 页面后，右下角没有出现蓝色悬浮按钮？
1. **检查当前网址**：确保当前页面域名为 `https://x.com` 或 `https://twitter.com`，且已经处于登录状态；
2. **检查油猴插件权限**：在 `chrome://extensions` -> Tampermonkey -> 详细信息 中，检查是否开启了「允许用户脚本」；
3. **刷新页面**：按 `F5` 或 `Cmd + R` 强制刷新网页；
4. **检查冲突**：若安装了其他屏蔽浮窗的广告拦截规则，可尝试暂时对 x.com 关停拦截。

### Q2: 扫描时提示「限频等待中」？
当您的关注数或粉丝数较多时，X 接口会触发官方保护限额（HTTP 429）。此时脚本会自动暂停等待 30~35 秒并自动继续拉取，无需手动干预，请耐心等待进度完成。

### Q3: 导出的 CSV 文件用 Excel 打开是乱码？
本工具导出的 CSV 文件默认添加了 `UTF-8 BOM` 标识头，Windows / Mac 上的微软 Excel、WPS 或 Numbers 均可原生双击正常打开，中文昵称与简介绝不乱码。

### Q4: 取关按钮点击后有效吗？
有效。列表中的「取关」按钮会调用 X 官方的好友关系注销接口。点击后会有确认弹窗，确认后立即执行，并实时从本地未回关列表中移除。

---

## 🔬 工作原理与安全性

本工具在前端通过浏览器原生 `fetch` 与 X 内部接口通信，遵循标准集合运算：

```text
关注总集合 (Following)   = 用户主动关注的账号全集
粉丝总集合 (Followers)   = 关注该用户的账号全集

------------------------------------------------------
🔴 未回关我 (单向关注)   = Following  - Followers
🟢 互相关注 (双向好友)   = Following  ∩ Followers
🔵 待回关我 (粉丝未关注) = Followers  - Following
```

- **认证安全**：直接借用当前浏览器标签页中的安全 Cookie（`ct0` CSRF Token 与认证凭证），不通过第三方任何中间层。
- **开源可审**：所有脚本代码完全开源透明，无任何混淆代码，欢迎审阅安全审计。

---

## 🛠️ 本地开发与测试

如需参与维护或验证代码完整性，可运行以下检查：

```bash
# JavaScript 语法检查
node --check x-mutual-checker.user.js
node --check extension/content.js
node --check extension/popup.js

# 核心算法与 CSV 导出测试
python3 -m unittest -v test_algorithm.py
```

---

## 📄 开源协议

本项目基于 [MIT 许可证](LICENSE) 开源。

Copyright © 2026 mrfan
