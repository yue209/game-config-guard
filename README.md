# TACTICAL CONFIG / 战术配置台

用于 AI 产品经理面试演示的“游戏配置检查与修复 Agent”。确定性代码负责 CSV、规则、补丁与游戏执行；模型只负责需求语义核对，且不能直接修改配置。

## 启动

要求 Node.js 20+，无第三方依赖。

```powershell
npm test
npm run dev
```

浏览器访问 `http://127.0.0.1:8788`。

## 模型配置

模型只在服务端读取密钥。PowerShell 本地启动示例：

```powershell
$env:OPENAI_API_KEY="你的服务端密钥"
$env:OPENAI_MODEL="gpt-5.5"
npm run dev
```

不要把密钥写入前端代码、CSV 或提交到 Git。未设置 `OPENAI_API_KEY` 时，确定性规则检查和内置演示需求契约仍可运行，页面会明确标记“AI 需求核对未运行”。

服务端使用 OpenAI Responses API 的 Structured Outputs。模型输出还会经过字段白名单、记录存在性、类型和业务范围校验；只有用户接受的补丁才会应用到工作副本。

## 示例文件

`examples/normal` 是正确配置；`examples/error` 同时包含金额不一致、缺失奖励引用、重复任务 ID 和负数奖励。页面内置同样的样例，可直接演示。

## 数据流

1. 浏览器解析或载入 CSV，保存原始配置和工作副本。
2. `/api/check` 执行确定性规则；有密钥时再调用模型做语义核对。
3. 候选修改经服务端白名单验证，用户逐项接受或拒绝。
4. 修改只落到工作副本，随后复检并产生新版本。
5. 预览沿 `task → reward → item` 读取当前配置并执行领取规则。
