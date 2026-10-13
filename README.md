# TACTICAL CONFIG / 战术配置台

用于 AI 产品经理面试演示的“游戏配置检查与修复 Agent”。`Qwen-Plus` 负责需求语义核对；确定性程序负责 CSV、规则、引用、补丁与游戏执行，模型不能直接修改配置。

## 启动

要求 Node.js 20+，无第三方依赖。

```powershell
npm test
npm run dev
```

浏览器访问 `http://127.0.0.1:8788`。

## 模型配置

模型只在服务端读取密钥。若希望本机以后每次启动都自动连接，复制 `.env.example` 为不会提交到 Git 的 `.env.local`，填入一次即可：

```powershell
Copy-Item .env.example .env.local
# 编辑 .env.local，填写 DASHSCOPE_API_KEY
npm run dev
```

开发服务器会按 `.env.local` → `.env` → `.dev.vars` 的顺序自动读取，已存在的系统环境变量优先。线上部署由 Vercel 的 Production/Preview 环境变量自动注入，所以访问者每次打开站点都会直接连接，前端不保存也看不到密钥。

默认调用北京地域默认业务空间的兼容接口。若使用其他地域或子业务空间，再设置：

```powershell
$env:DASHSCOPE_BASE_URL="你的 compatible-mode/v1 地址"
```

不要把密钥写入前端代码、CSV 或提交到 Git。未设置 `DASHSCOPE_API_KEY` 时，确定性规则检查和内置演示需求契约仍可运行，页面会明确标记“Qwen-Plus 未配置”。

服务端使用阿里云百炼 OpenAI 兼容 Chat Completions 与 JSON Schema 结构化输出。模型输出还会经过字段白名单、记录存在性、类型和业务范围校验；只有用户接受的补丁才会应用到工作副本。

## Agent 工具

- `read_config`：读取三张配置表的真实数据。
- `validate_config`：重复 ID、引用、类型与范围检查。
- `find_references`：查看奖励影响了哪些任务。
- `propose_patch`：验证候选修改并生成差异。
- `apply_patch`：确认后修改工作副本。
- `run_preview`：按指定配置执行完成任务与发奖。

这些工具是 Worker 内的真实后端函数，并通过检查、应用和预览接口编排。项目只处理 CSV 与文字，不使用图片识别 API。

## 示例文件

`examples/normal` 是正确配置；`examples/error` 同时包含金额不一致、缺失奖励引用、重复任务 ID 和负数奖励。页面内置同样的样例，可直接演示。

## 数据流

1. 浏览器解析或载入 CSV，保存原始配置和工作副本。
2. `/api/check` 执行确定性规则；有密钥时再调用模型做语义核对。
3. 候选修改经服务端白名单验证，用户逐项接受或拒绝。
4. 修改只落到工作副本，随后复检并产生新版本。
5. 预览沿 `task → reward → item` 读取当前配置并执行领取规则。

## 部署到 Vercel

仓库已包含 `vercel.json` 和 Node.js Serverless Function 入口 `api/entry.js`。在 Vercel 导入 GitHub 仓库后，无需设置构建命令；添加以下 Production 环境变量即可：

- `DASHSCOPE_API_KEY`：设为 Secret。
- `QWEN_MODEL`：`qwen-plus`。
- `DASHSCOPE_BASE_URL`：`https://dashscope.aliyuncs.com/compatible-mode/v1`。

Vercel 入口只是适配层，规则、补丁和预览仍统一复用 `worker/index.js`，避免两套业务逻辑产生差异。
