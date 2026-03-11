# 行政处罚预警平台

政府检查与行政处罚事件管理系统，支持企微登录、数据上传、多维度筛选。

## 🌐 在线访问

部署后访问：`https://your-service.onrender.com`

## ✨ 功能特性

- 📱 移动端/PC端自适应
- 🔐 企业微信OAuth登录
- 📤 Excel文件拖拽上传
- 🔔 四大预警模块
- 🔍 多维度数据筛选

## 🚀 Render 部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

或手动部署：

1. Fork 本仓库
2. 登录 [Render](https://render.com)
3. New → Web Service → 选择本仓库
4. 配置:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 点击 Create

## ⚙️ 环境变量

| 变量名 | 说明 | 必填 |
|--------|------|------|
| SESSION_SECRET | Session加密密钥 | ✅ |
| WECHAT_CORPID | 企微CorpID | ❌ |
| WECHAT_AGENTID | 企微AgentID | ❌ |
| WECHAT_SECRET | 企微Secret | ❌ |

## 📄 许可证

MIT
