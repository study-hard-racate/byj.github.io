# BYJ 的个人看板

个人财务看板 + 习惯健康追踪，**纯前端应用**，部署在 GitHub Pages。

- 💰 账单管理：导入支付宝 / 微信官方导出的 CSV，自动分类，图表分析
- ❤️ 健康打卡：每天 20 秒记录睡眠 / 心情 / 体重 / 运动
- 📈 年度报告：一年花了多少、状态怎么样，一键生成
- 💾 数据 100% 存在**你的浏览器本地**（IndexedDB），不联网、不上传
- 📲 PWA：可安装到手机 / 电脑桌面，断网也能用

线上地址：<https://study-hard-racate.github.io/byj.github.io/>

---

## 本地运行

任选一种静态服务器，在项目根目录启动：

```bash
# Python
python -m http.server 8000

# 或 Node
npx serve .
```

浏览器打开 `http://127.0.0.1:8000`。首次打开会自动填充一份演示数据，可在「设置」里清空。

## 怎么用

1. **导入账单**：
   - **支付宝**：App 里导出「用于个人对账」的 CSV（官方 zip 带密码，先解压成 CSV）
   - **微信**：账单下载选「**用于个人对账**」，邮件附件是 **.xlsx Excel 文件，直接上传**（选「用作证明材料」得到的是 PDF 凭证，不能导入）
   - 在「导入规则」页上传 → 预览 → 确认导入。GBK / UTF-8 / Excel 日期格式自动识别，按内容指纹自动去重。
2. **改分类**：财务页点分类标签即可修改，勾选后自动记住商户，下次自动归对。
3. **打卡**：健康页每天 20 秒。
4. **备份**：设置页导出 JSON 备份，换设备时导入恢复。

## 部署到 GitHub Pages

1. 把代码推到仓库（例如 `byj.github.io` 的 `main` 分支）。
2. 仓库 Settings → Pages → Source 选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`，Save。
3. 等 1~2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

## 定制

- 品牌名 / 主色 / 默认预算 / 提醒时间：改 [`js/config.js`](js/config.js)
- 站名 / LOGO / 预算 / 提醒 / 备份：网页「设置」页直接改

## 目录结构

```
├── index.html / finance.html / health.html   # 页面
├── import.html / report.html / settings.html
├── css/style.css          # 样式（深/浅主题 + 移动端适配）
├── js/
│   ├── config.js          # 站点配置
│   ├── db.js              # IndexedDB 数据层 + 统计
│   ├── xlsx.js            # 极简 .xlsx 解析（零依赖）
│   ├── parsers.js         # 账单解析（CSV / Excel，本地）
│   ├── categories.js      # 分类规则 + 配色
│   ├── charts.js          # 自研 SVG 图表（零依赖）
│   ├── app.js / layout.js / seed.js
│   └── page-*.js          # 各页面逻辑
├── icons/                 # PWA 图标
├── manifest.webmanifest   # PWA 清单
├── sw.js                  # Service Worker（离线缓存）
└── legacy/                # 原 Flask 版代码（参考）
```

## 说明

- 纯前端方案的限制：提醒只在**打开网站时**生效；支付宝的 zip 需先解压成 CSV（微信对账导出已是 Excel，可直接上传）。
- 原 Flask + SQLite 桌面版保留在 [`legacy/`](legacy/)，想回归本地服务版可参考其 README。
