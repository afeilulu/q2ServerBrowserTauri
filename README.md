# Quake 2 Server Browser (Tauri 轻量化重构版)

本项目是原 Go + Fyne 版本的完全轻量化复刻，基于 **Tauri v2 (Rust Backend + HTML/JS/CSS Vanilla Frontend)** 架构实现。

---

## ⚡ 卓越的轻量化成果

| 属性 | 原 Go + Fyne 版本 | Tauri 重构版本 | 瘦身幅度 |
| :--- | :--- | :--- | :--- |
| **可执行文件大小** | ~50 MB (`48,000,000+` 字节) | **1.72 MB** (`1,809,408` 字节) | **缩减 96.5% ⬇️** |
| **内存占用** | 较重 (OpenGL 渲染引擎) | 极轻 (共享 OS 原生 Webview) | **显著下降** |
| **渲染架构** | 独占渲染引擎 | 系统原生渲染器 (WebView2) | **更符合现代桌面软件规范** |

> [!TIP]
> 编译产物已通过 UPX (Ultimate Packer for eXecutables) 压缩至 **1.72 MB**，是一个完全独立运行的单文件可执行程序。

---

## 🎮 复刻功能特性

本版本 100% 还原并升级了原版的核心功能：
1. **Quake 2 UDP 查询协议**：用 Rust 编写的高并发、无阻塞 `std::net::UdpSocket` 网络查询，完美替代 Go 的 UDP 逻辑。
2. **服务器管理**：支持添加、删除、选中查看在线玩家列表等。
3. **数据持久化**：自动读取和保存 `settings.json` 和 `servers.json` 到操作系统的应用数据目录（`%APPDATA%/com.chengefei.q2-server-browser-tauri`）。
4. **后台自动刷新**：支持配置 5秒 / 30秒 频率进行后台静默状态轮询。
5. **新玩家上线通知**：在后台自动刷新时检测新玩家，并通过系统原生通知（Notification）API 发送通知。
6. **系统托盘集成**：
   - 包含“显示窗口”、“隐藏窗口”、“退出”菜单。
   - 支持左键单击托盘图标切换窗口显示状态。
   - 支持设置“启动时最小化到托盘”和“点击关闭按钮时最小化到托盘”。

---

## 🛠️ 项目结构

```
q2-server-browser-tauri/
├── src/                      # 前端网页 (HTML/CSS/JS)
│   ├── index.html            # 主界面结构 (Outfit 字体、SVG 图标)
│   ├── styles.css            # 现代暗黑系毛玻璃效果 CSS
│   └── main.js               # 页面交互逻辑，通过 Tauri 核心 API 调用 Rust 命令
├── src-tauri/                # 后端逻辑 (Rust)
│   ├── src/
│   │   ├── main.rs           # 程序入口
│   │   └── lib.rs            # 核心逻辑 (UDP 协议解析、后台刷新线程、系统托盘、Tauri Command)
│   ├── Cargo.toml            # Rust 依赖 (启用 tauri "tray-icon" 特征)
│   ├── capabilities/         # Tauri 权限控制 (已配置允许系统通知)
│   └── tauri.conf.json       # Tauri 配置文件 (窗口大小 800x600, 启用 windowGlobalTauri)
└── package.json              # 项目依赖
```

---

## 🚀 运行与构建

在 `q2-server-browser-tauri` 目录下执行：

### 1. 开发运行
```bash
npm run tauri dev
```

### 2. 编译打包 (生成 Executable)
```bash
npm run tauri build -- --no-bundle
```
编译成功后，可执行文件将输出在：
`src-tauri/target/release/q2-server-browser-tauri.exe`

### 3. 一键 UPX 压缩 (可选)
使用 UPX 压缩编译产物：
```bash
upx --best --lzma src-tauri/target/release/q2-server-browser-tauri.exe
```

---

## 🎨 界面设计理念
*   **现代暗黑美学**：使用深邃的太空蓝黑色系作为背景，搭配霓虹紫（Indigo）和翡翠绿（Emerald）等高对比度状态指示器。
*   **毛玻璃特效**：弹窗和侧边栏采用半透明高模糊的背景模糊滤镜（Glassmorphism），显得极具高级感。
*   **响应式侧边栏**：左侧为服务器导航卡片（实时显示状态、地图和 Ping 颜色），右侧为详情及在线玩家表格，清晰直观。

---

## 📄 许可证

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 协议开源。

