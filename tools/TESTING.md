# 测试约定（换会话/换设备必读）

## 单元测试（Node，无需浏览器）

```bash
node tools/run-tests.js          # 一键跑全部（63 项），等价于 npm test
# 或单个：
node tools/unit-test-parsers.js  # 解析器 16 项
node tools/unit-test-xlsx.js     # Excel 15 项
node tools/unit-test-robust.js   # 健壮性 16 项
node tools/unit-test-db.js       # 数据层 16 项
```

- 改解析器 / xlsx / 数据层 / 备份逻辑后必须跑全量；测试数据由 `tools/gen_test_xlsx.py`、`tools/gen_extra_tests.py` 生成。
- 提示：Node 里加载页面 JS 用 `new Function(src + "; return {...}")`；`parsers.js` 依赖 `xlsx.js` 全局，需合并同作用域加载。
- 路径约定：测试脚本一律用 `path.join(__dirname, "..")` 定位项目根，**不要写绝对路径**，否则换机器/换目录就全线报错。
- `unit-test-db.js` 覆盖 IndexedDB 数据层（导入去重与「新增条数」、分类锁定、月度统计、备份往返）。Node 没有 IndexedDB，脚本里注入了一个最小内存实现，只实现了 `db.js` 真正用到的那部分 API；给 `db.js` 增加新的 IDB 调用时要同步补这个假实现。

## 浏览器端到端（tabbit 托管浏览器）

**关键限制（实测踩过）**：
- 每会话/工作区**任务上限 8 个**（`TASK_LIMIT_REACHED`，新会话自动重置）；任务名复用同名可续，但旧上下文可能已失效（CDP 错误），宁可换新名。
- 禁 `file://` 导航；文件选择器 `setInputFiles` 不可用、下载事件被禁。
- 页面 `confirm()` 弹窗默认被拒 —— 需 `page.on("dialog", d => d.accept())`。

**调用方式（Windows）**：任务 JS 写到 `%TEMP%`，批处理重定向执行：
```bat
"%LOCALAPPDATA%\Tabbit\LocalAgent\bin\tabbit-cli.exe" nodejs --task byj-xxx < "%TEMP%\byj-xxx.js"
```
（先 `cmd /c` 运行；本机 PowerShell 5.1 不支持 `<` 重定向）

**测试脚本骨架约定**：
1. 先导航到目标页并 `waitForFunction(() => typeof 某全局 === "function")` —— 别用 `waitForSelector('#fileInput')`（display:none 会等到超时）。
2. **注入文件**（模拟上传）：在页面上下文 `atob(b64)` → `Uint8Array` → `new File([bytes], 名)` → `DataTransfer` → 赋给 `input.files` → `dispatchEvent(new Event("change"))`。
3. **清 SW 旧缓存**（否则加载到旧 JS 假失败）：`navigator.serviceWorker.getRegistrations()` 逐个 `unregister()` + `caches.keys()` 逐个 `delete`，再 reload。
4. 字节级对比用 `page.evaluate` 内 `fetch` 文件 vs 注入字节；**ArrayBuffer 与 Uint8Array 别混**（`file.arrayBuffer()` 返回 ArrayBuffer，解析器入口已统一转换）。
5. 等待异步结果用轮询函数（300ms 间隔），别依赖瞬时 toast。
6. 记录 `pageerror` / `console.error` 到结果里，零报错是验收标准。

**每会话 e2e 范围建议**（覆盖核心路径即可）：首页渲染 → 财务（记一笔/改分类）→ 健康（打卡+空态）→ 导入（xlsx/CSV）→ 设置（备份导出/导入往返）→ 移动视口 390px 卡片布局 → 无横向滚动。

## 移动端回归审计（M3）

```bash
# 复制审计脚本到 %TEMP%（BASE 默认线上；本地测先把开头 BASE 改成本地地址）
# 然后按下方「调用方式」执行：nodejs --task byj-audit < audit.js
```

通过标准：0 横向溢出 / 无控制台报错 / 核心触控 ≥40px / ≤640px 输入框字号 ≥16px（iOS 不缩放）/ 最小可见字号 ≥11px。不达标会在结果里列出 violations。

**⚠️ HTTP 缓存陷阱（反复踩过，务必照做）**：即使清掉 Service Worker 缓存，HTTP 层仍可能把旧 css/js 端上来 → 审计看到的是旧文件。实测结论：
1. **`python -m http.server` 不足以避开这个坑**（旧文档写"无缓存头所以结果可信"，是错的）：它不带 `Cache-Control`，浏览器改用启发式新鲜度缓存，旧条目在新鲜期内**根本不会去问服务器**，所以后加 `no-store` 也救不回来（服务器压根没被访问）。稳妥做法：用带 `no-store` 的本地服务器，**并换一个新端口**（新 origin = 空 HTTP 缓存 + 空 SW + 空 IndexedDB），或在审计前清掉浏览器 HTTP 缓存。
2. `?bust=...` 只能绕过 HTML，**绕不过 css/js 子资源** —— 别以为加了时间戳就拿到新代码。
3. 无论怎么清，**审计脚本里都要有"新代码真的生效了"的断言**（如 `typeof pageSize === "function"`、扫 `document.styleSheets` 是否含新规则、或直接断言新行为）。否则会把旧文件的失败当成真失败、把旧文件的通过当成真通过。
4. 线上审计前先确认部署：`Invoke-WebRequest -Headers @{"Cache-Control"="no-cache"}` 拉 css/js 与 `git cat-file blob HEAD:<f>` 做 SHA256 字节比对，一致后再审计。
5. 对真实用户：发版必须 bump `sw.js` 的 CACHE（新 SW 会重取资源）；GitHub Pages 静态资源 HTTP 缓存约 10 分钟内自然过期，用户硬刷新一次最快。

## 线上验证清单（改完推送后）

1. `git fetch && git status` 确认已同步。
2. 推送后等 1~2 分钟 Pages 自动部署。
3. 线上对比（字节级，注意 PowerShell 文本对比会被编码骗）：`git cat-file blob HEAD:<f>` 落盘 vs `Invoke-WebRequest -OutFile`，`Get-FileHash` 比对。
4. tabbit 打开线上 URL 跑一遍 e2e；若用户报"没变化"，多半是 SW 旧缓存 —— 记得发布时 bump `sw.js` 的 `CACHE` 版本（当前 v10）。
