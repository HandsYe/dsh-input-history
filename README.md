# dsh-input-history

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen.svg)](#开发)

**中文** | [English](README.en.md)

为 DeepSeek Harness 的对话框提供持久化输入历史：发送过的内容会保存下来，用 `↑` / `↓` 随时回溯，重启应用也不丢。

## 功能

- 发送过的内容保存到本地存储，重启后仍在
- 输入框为空时按 `↑` 回溯更早的记录
- 按 `↓` 回到更新的记录，走到末尾时恢复未被改动的草稿
- 连续按 `↑` / `↓` 可以一直回溯，不需要每次重新把光标移到开头
- 手工修改回溯出来的内容后，方向键立即交还给编辑器（不再拦截）
- 自动忽略空白内容；重复内容只保留最新的一条；最多保留 200 条
- 输入法组合输入期间不拦截按键
- 不拦截带 `Shift`、`Ctrl`、`Alt`、`Meta` 修饰键的方向键
- 斜杠命令、`@` 引用等弹窗打开时，方向键仍归弹窗使用

## 工作原理

Harness 的输入框是 **Lexical 驱动的 `contenteditable`**，不是 `<textarea>`。因此本插件不做 DOM 文本替换，而是接入 Harness 自身的接口：

| 用途 | 接口 |
| --- | --- |
| 读取当前草稿 | 会话输入 shell 的 `snapshot.draft` |
| 写入草稿 | shell 的 `setDraft(text)`（官方 programmatic write，会把光标置于末尾） |
| 跟踪输入框元素 | `shell.editor.registerRootListener(...)` |
| 让出弹窗按键 | `shell.arbitrate(key, composing)`，只有返回 `"pass"` 时才处理 |
| 挂载会话桥梁 | `conversation.input.left` / `conversation.input.right`（`list` 类型、按会话作用域） |

按键监听装在 `document` 的**捕获阶段**，因此先于编辑器自身的键位处理运行；命中时调用 `stopPropagation()`，避免光标同时移动。

历史记录在输入框被清空时写入 —— 发送按钮、回车、排队插话都会清空草稿，这是各条发送路径共用的信号。

## 兼容性

| 项目 | 值 |
| --- | --- |
| 开发环境 | DSH Desktop `2.0.13`（Windows） |
| 客户端核心 | `@deepseek-ai/dsh@0.1.5-rc.2` |
| 客户端界面 | `@deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.2` |
| 平台 | `web`（桌面端与网页端共用同一套客户端） |
| Node | `>= 22` |

插件依赖上表列出的输入框接口（`conversation.input`、`setDraft`、`registerRootListener`、`arbitrate`）。较旧的 Harness 构建如果没有这些接口，插件会**静默不生效**而不会报错。

## 安装

### 1. 把插件挂到 profile

编辑 `%USERPROFILE%\.dsh\profiles\<profile>\package.json`，分两处：

```json
{
  "dependencies": {
    "dsh-input-history": "link:/absolute/path/to/dsh-input-history"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-input-history"
      ]
    }
  }
}
```

### 2. 安装依赖

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
# 把 <DSH 安装目录> 换成你自己的安装位置
node "<DSH 安装目录>\resources\app\node_modules\pnpm\bin\pnpm.cjs" install
```

桌面端自带的 pnpm 就在安装目录下的 `resources\app\node_modules\pnpm\bin\pnpm.cjs`。

### 3. 重启 DSH Desktop

### 用 `link:` 而不是 `file:`

这一点很关键：

| 协议 | 行为 | 改源码后 |
| --- | --- | --- |
| `file:` | pnpm **复制**一份到 `node_modules` | 需要重新 `install`，否则改动不生效 |
| `link:` | 创建 Junction 指向源码目录 | 直接生效，重启即可 |

用 `file:` 时，`node_modules/dsh-input-history` 是一个真实目录副本。改了源码却没重新安装，应用加载的仍然是旧代码 —— 表现为「改了半天没反应」。

### 不要用 npm 安装

> **DSH Desktop 的 profile 由 pnpm 管理**（`nodeLinker: hoisted`）。用 `npm install` 会按 npm 的规则重写 `node_modules` 目录结构，删除其它插件依赖的共享包，导致重启报错。
>
> 请始终使用桌面端自带的 pnpm（路径见上方第 2 步）。

### 作为发布包安装

```powershell
npm pack
```

生成的 `.tgz` 可以分发给其他人。注意包内是**快照**，不是实时链接。

## 使用

1. 在会话输入框输入内容并发送。
2. 把光标放回输入框。
3. 按 `↑` 依次回溯更早的内容。
4. 按 `↓` 回到更新的内容。
5. 走到末尾后再按 `↓`，会恢复回溯前尚未发送的草稿。

## 数据存储

历史记录仅保存在当前应用 WebView 的本地存储中：

```text
dsh-input-history:v1
```

不会上传到网络，也不需要任何服务端能力（`lib/index.js` 是空的运行时入口）。清除站点数据会一并删除历史记录。

## 故障排查

**方向键完全没反应**

先确认 profile 里加载的是新代码，而不是 `file:` 留下的旧副本：

```powershell
$t = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-input-history"
Get-Item $t -Force | Select-Object LinkType, Target
Select-String -LiteralPath "$t\lib\client.js" -Pattern 'registerRootListener'
```

- `LinkType` 应为 `Junction` 且 `Target` 指向你的源码目录；为空说明是副本
- `registerRootListener` 应有命中；找不到说明加载的是旧版本

**`↑` 能回溯但第二次按没反应**

确认版本 `>= 0.2.0`。`0.1.0` 针对 `<textarea>` 编写，在 Lexical 输入框上永远不会触发。

**重启报错**

检查是否误用 npm 安装过。正常状态下这些应成立：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
Test-Path package-lock.json                  # 期望 False
Test-Path node_modules\.package-lock.json    # 期望 False
```

如果存在，删除后重新用 pnpm 安装。

## 开发

```powershell
npm test
```

测试覆盖三层：

1. **历史存储与回溯决策** —— 纯函数，无需浏览器
2. **光标边界探测** —— 使用 Range 替身（证明探测算术，不代表真实浏览器 Range 行为）
3. **完整按键链路** —— 从桥接挂载、`registerRootListener`、`keydown` 到 `setDraft`，通过插件真实安装在 `document` 上的监听器驱动

实现位于 `lib/client.js`，全部行为都在网页客户端侧。

## 许可证

MIT
