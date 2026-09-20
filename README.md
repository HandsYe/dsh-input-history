# dsh-input-history

为 DeepSeek Harness 网页输入框提供持久化的输入历史记录，并支持使用键盘方向键快速切换。

## 功能

- 输入内容发送后保存到浏览器 `localStorage`
- 按 `↑` 查看更早的输入记录
- 按 `↓` 查看更新的输入记录，并在末尾恢复当前未发送的草稿
- 自动忽略空白输入
- 重复内容只保留最新的一条
- 最多保留 200 条记录
- 多行文本中，仅当光标位于第一行时用 `↑` 切换历史，仅当光标位于最后一行时用 `↓` 切换历史
- 输入法组合输入期间不拦截按键
- 不拦截带有 Shift、Ctrl、Alt 或 Meta 修饰键的方向键

## 安装

在插件目录中打包：

```powershell
npm pack
```

然后使用生成的 `.tgz` 文件安装到 DeepSeek Harness，或将本目录作为本地插件包使用。安装完成后重启 DeepSeek Harness。

## 使用

1. 在会话输入框中输入内容并发送。
2. 将焦点放回输入框。
3. 按 `↑` 依次查看之前发送的内容。
4. 按 `↓` 向较新的记录移动。
5. 移动到历史记录末尾后，再按 `↓` 会恢复切换历史前尚未发送的草稿。

## 数据存储

历史记录仅保存在当前浏览器或桌面应用 WebView 的本地存储中：

```text
dsh-input-history:v1
```

插件不会把历史记录上传到网络。清除应用站点数据或浏览器本地存储会删除历史记录。

## 开发与测试

运行测试：

```powershell
npm test
```

主要实现位于：

```text
lib/client.js
```

运行时入口 `lib/index.js` 不执行服务端逻辑，实际功能由网页客户端模块提供。

## 兼容性说明

插件通过捕获阶段监听输入框的 `keydown`、`keyup` 和表单 `submit` 事件，因此不需要修改 DeepSeek Harness 自带文件。客户端必须提供标准的 `HTMLTextAreaElement`、`localStorage` 和 DOM Event API。

## 许可证

MIT
