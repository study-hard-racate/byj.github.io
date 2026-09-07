# 测试约定（换会话/换设备必读）

## 单元测试（Node，无需浏览器）

```bash
node tools/run-tests.js          # 一键跑全部（44 项）
# 或单个：
node tools/unit-test-parsers.js  # 解析器 13 项
node tools/unit-test-xlsx.js     # Excel 15 项
node tools/unit-test-robust.js   # 健壮性 16 项
```

- 改解析器/xlsx/备份逻辑后必须跑全量；测试数据由 `tools/gen_test_xlsx.py`、`tools/gen_extra_tests.py` 生成。
- 提示：Node 里加载页面 JS 用 `new Function(src + "; return {...}")`；`parsers.js` 依赖 `xlsx.js` 全局，需合并同作用域加载。

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

**⚠️ HTTP 缓存陷阱（踩过）**：GitHub Pages 给 css/js 带缓存头，tabbit 浏览器即使清掉 Service Worker 缓存，HTTP 层仍可能给出旧文件 → 审计结果"没变化"其实是旧 css。对策：
1. 首选**对本地服务器审计**（python http.server 无缓存头，结果可信）。
2. 或线上审计前先确认部署：`Invoke-WebRequest -Headers @{"Cache-Control"="no-cache"}` 拉 css/js 与 `git cat-file blob HEAD:<f>` 做 SHA256 字节比对，一致后再审计。
3. 对真实用户：发版必须 bump `sw.js` 的 CACHE（新 SW 会重取资源）；GitHub Pages 静态资源 HTTP 缓存约 10 分钟内自然过期，用户硬刷新一次最快。

## 线上验证清单（改完推送后）

1. `git fetch && git status` 确认已同步。
2. 推送后等 1~2 分钟 Pages 自动部署。
3. 线上对比（字节级，注意 PowerShell 文本对比会被编码骗）：`git cat-file blob HEAD:<f>` 落盘 vs `Invoke-WebRequest -OutFile`，`Get-FileHash` 比对。
4. tabbit 打开线上 URL 跑一遍 e2e；若用户报"没变化"，多半是 SW 旧缓存 —— 记得发布时 bump `sw.js` 的 `CACHE` 版本（当前 v5）。
