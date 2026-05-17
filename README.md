# 靶式看板 / Target Board

一个本地运行的"靶环式"任务看板。用三层同心圆把任务按优先级（紧急 / 需要做 / 应做）可视化，支持多用户、拖拽分区、DDL 提醒和历史记录。

数据存在浏览器 `localStorage` 里，无后端、无账号系统。

## 功能

- **极简首页** — 只有靶环 + 左侧（手机底部）的图标导航栏；功能面板按需弹出，画布永远是主角
- **靶环优先级** — 三个同心圆代表三档优先级，越靠近圆心越紧急
- **流畅拖拽** — Pointer Events 实现，桌面 / iPad / 手机一致体验；拖动时目标圆环高亮，松手自动夹回靶内
- **点击卡片即编辑** — 不再需要找小按钮
- **半透明浮窗** — 添加 / 筛选 / 用户 / 统计 / 历史 各占一个图标，点击展开，再点击收起
- **多用户** — 自定义用户名 / 颜色，可按用户筛选；新用户自动分配易读 HSL 色
- **DDL 状态** — 自动标记"已逾期" / "即将到期"
- **键盘加速** — `Ctrl/⌘+K` 一键展开"添加任务"，`Enter` 添加，`Esc` 关闭面板与模态
- **响应式** — 桌面图标在左侧，手机图标变底部 tab 栏；浮窗在手机变底部抽屉
- **本地持久化** — 全部数据存在 localStorage，刷新不丢；自动迁移旧版数据

## 启动

项目是纯静态 HTML/CSS/JS，任选一种方式启动本地服务器：

### 方式 1：Python（无需安装依赖）

```bash
python3 -m http.server 8000
```

浏览器打开 http://localhost:8000/

### 方式 2：npm

```bash
npm start
```

浏览器打开 http://localhost:3000/

### 方式 3：直接打开

双击 `index.html` 也可以用，但部分浏览器会限制 `localStorage` 在 `file://` 协议下的行为，推荐用本地服务器。

## 键盘快捷键

| 键 | 作用 |
|---|---|
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd> | 一键展开"添加任务"面板并聚焦标题输入框 |
| <kbd>Enter</kbd>（在标题框） | 添加任务 |
| <kbd>Enter</kbd>（在编辑模态） | 保存修改 |
| <kbd>Esc</kbd> | 关闭浮窗 / 编辑模态 |

## 在 iPhone 上当 App 用（PWA）

项目已配置成 PWA，可以"添加到主屏幕"后像原生 App 一样使用：图标、全屏、离线可用、独立任务切换器。

### 步骤

1. **先把项目部署到 HTTPS**（service worker 要求）。最快的几条路：
   - **GitHub Pages**：把项目推到一个 public 仓库 → Settings → Pages → 选 main 分支根目录
   - **Netlify / Vercel / Cloudflare Pages**：拖拽整个项目文件夹即可，秒级部署
   - **本地局域网测试**：用 [`ngrok http 8000`](https://ngrok.com) 或 Cloudflare Tunnel 暴露 https URL
2. **iPhone 用 Safari 打开** 部署后的 URL（注意：必须 Safari，Chrome/Edge 等不支持 iOS PWA）
3. 点底部 **"分享"** 按钮 → **"添加到主屏幕"**
4. 命名（默认"靶式看板"）→ **添加**
5. 回到主屏幕，点开图标即可。**全屏、离线、独立窗口**

### iOS PWA 注意事项

- 数据存在该 PWA 沙箱的 localStorage，不会被 Safari 的"清除浏览数据"影响（但卸载 PWA 会清掉）
- 没有 Push 通知 / 后台同步（iOS 限制）
- 状态栏样式跟随系统亮/暗模式
- iOS 16.4+ 支持 Web Push 但需要更多配置，本项目目前不用

## 项目结构

```
.
├── index.html              # 入口
├── styles.css              # 样式
├── app.js                  # 全部逻辑
├── icon.svg                # 应用图标（PWA / 浏览器 favicon）
├── manifest.webmanifest    # PWA 清单
├── sw.js                   # service worker（离线缓存）
├── package.json            # 仅用于提供 npm start 脚本
├── .claude/
│   └── launch.json         # Claude Code 预览服务器配置
├── README.md
└── LICENSE
```

## 浏览器兼容性

需要支持 ES2020、Pointer Events 和 CSS Grid 的现代浏览器：
Chrome / Edge ≥ 89、Safari ≥ 14、Firefox ≥ 90、iOS Safari ≥ 14。
