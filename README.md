# dsh-input-history

为 DeepSeek Harness 的对话框提供持久化输入历史，用 `↑` / `↓` 快速回溯之前发送过的内容。

## 功能

- 发送过的内容保存到本地存储，重启后仍在
- 输入框为空时按 `↑` 回溯更早的记录
- 按 `↓` 回到更新的记录，走到末尾时恢复未被改动的草稿
- 继续按 `↑` / `↓` 可连续回溯，不需要每次重新把光标移到开头
- 手工修改回溯出来的内容后，方向键立即交还给编辑器（不再拦截）
- 自动忽略空白内容
- 重复内容只保留最新的一条
- 最多保留 200 条
- 输入法组合输入期间不拦截按键
- 不拦截带 Shift、Ctrl、Alt、Meta 修饰键的方向键
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

监听器装在 `document` 的**捕获阶段**，因此先于编辑器自身的键位处理运行；命中时调用 `stopPropagation()`，避免光标同时移动。

历史记录在输入框被清空时写入 —— 发送按钮、回车、排队插话都会清空草稿，这是各条发送路径共用的信号。

## 安装

### 作为本地插件目录

把仓库路径加入目标 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-input-history": "file:D:/path/to/dsh-input-history"
  }
}
```

并在同一个 `package.json` 的 `dsh.profile.bundles` 中加入 `dsh-input-history`。

> **请使用 Profile 自身的管理器安装。** DSH Desktop 的 profile 由 **pnpm** 管理（`nodeLinker: hoisted`）。用 `npm install` 安装会重写 `node_modules` 目录结构，并可能删除其它插件依赖的共享包，导致启动报错。

使用桌面端自带的 pnpm：

```powershell
node "<DSH install dir>\resources\app\node_modules\pnpm\bin\pnpm.cjs" install
```

### 打包分发

```powershell
npm pack
```

`file:` 形式的依赖指向源码目录，改动源码后重启应用即可生效。

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

不会上传到网络。清除站点数据会一并删除历史记录。

## 开发与测试

```powershell
npm test
```

测试覆盖三层：历史存储与回溯决策（纯函数）、光标边界探测（使用 Range 替身）、以及从挂载到 `setDraft` 的完整按键链路（通过插件真实安装在 `document` 上的监听器驱动）。

实现位于：

```text
lib/client.js
```

`lib/index.js` 是运行时入口，不承载功能；实际行为全部由网页客户端模块提供。

## 许可证

MIT
