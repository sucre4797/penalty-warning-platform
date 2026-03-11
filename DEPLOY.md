# 行政处罚预警平台 - 部署指南

## 📋 系统要求

- Node.js 18+ 
- 公网服务器（阿里云/腾讯云/AWS等）
- 域名（推荐）
- 企业微信管理员权限

---

## 🚀 部署步骤

### 1. 服务器准备

购买云服务器（推荐配置）：
- CPU: 1核+
- 内存: 2GB+
- 带宽: 3Mbps+
- 系统: Ubuntu 20.04/22.04 或 CentOS 7+

### 2. 安装Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# 验证安装
node -v  # 应显示 v20.x.x
npm -v
```

### 3. 部署应用

```bash
# 创建应用目录
mkdir -p /opt/penalty-warning-platform
cd /opt/penalty-warning-platform

# 上传项目文件
# 方式1: 使用git
git clone <你的代码仓库> .

# 方式2: 直接上传压缩包
# 上传 penalty-warning-platform.zip 后解压
unzip penalty-warning-platform.zip

# 安装依赖
npm install
# 或使用 pnpm
npm install -g pnpm
pnpm install
```

### 4. 配置环境变量

```bash
# 创建环境变量文件
nano /opt/penalty-warning-platform/.env
```

写入以下内容：

```env
# 服务配置
PORT=5500
BASE_URL=https://your-domain.com
SESSION_SECRET=your-random-secret-key-change-this

# 企业微信配置（见下文企微配置部分）
WECHAT_CORPID=wwxxxxxxxxxxxxxxxx
WECHAT_AGENTID=1000002
WECHAT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. 使用PM2启动服务（生产环境）

```bash
# 安装PM2
npm install -g pm2

# 启动服务
cd /opt/penalty-warning-platform
pm2 start server.js --name "penalty-platform"

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status
pm2 logs penalty-platform
```

### 6. 配置Nginx反向代理（推荐）

```bash
# 安装Nginx
sudo apt install nginx

# 创建配置文件
sudo nano /etc/nginx/sites-available/penalty-platform
```

写入配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL证书配置（使用Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # 反向代理到Node.js应用
    location / {
        proxy_pass http://localhost:5500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/penalty-platform /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 7. 配置SSL证书（Let's Encrypt）

```bash
# 安装Certbot
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

---

## 🔐 企业微信登录配置

### 1. 登录企业微信管理后台

访问: https://work.weixin.qq.com/wework_admin

### 2. 创建自建应用

1. 进入【应用管理】
2. 点击【创建应用】
3. 上传应用Logo
4. 应用名称: 行政处罚预警平台
5. 选择可见成员（哪些员工可以使用）
6. 创建完成后，记录 **AgentID** 和 **Secret**

### 3. 配置网页授权

1. 进入刚创建的应用详情
2. 找到【网页授权及JS-SDK】
3. 设置可信域名: `your-domain.com`
4. 下载验证文件并上传到网站根目录
5. 配置授权回调域: `your-domain.com`

### 4. 获取企业ID (CorpID)

1. 进入【我的企业】
2. 最底部找到 **企业ID** (格式: wwxxxxxxxxxxxxxxxx)

### 5. 配置环境变量

将获取到的三个值填入服务器的环境变量：

```bash
nano /opt/penalty-warning-platform/.env
```

```env
WECHAT_CORPID=wwxxxxxxxxxxxxxxxx
WECHAT_AGENTID=1000002
WECHAT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BASE_URL=https://your-domain.com
```

重启服务：

```bash
pm2 restart penalty-platform
```

---

## 🧪 测试验证

### 1. 测试基本访问

浏览器访问: `https://your-domain.com`

应该跳转到登录页面。

### 2. 测试企微登录

1. 在手机上打开企业微信
2. 进入【工作台】
3. 找到【行政处罚预警平台】应用
4. 点击进入，应该自动登录

### 3. 测试演示登录（未配置企微时）

如果企微未配置，点击登录页的【演示账号登录】按钮。

---

## 🔧 常见问题

### Q1: 提示"企业微信配置错误"

检查环境变量是否正确设置：
```bash
cd /opt/penalty-warning-platform
pm2 logs
```

### Q2: 登录后跳转回登录页

检查 `BASE_URL` 是否与访问域名一致（包括https）。

### Q3: 无法获取用户信息

确保企业微信应用设置了正确的【网页授权回调域】。

### Q4: 如何禁用演示登录

删除或注释掉 `server.js` 中的 `/api/demo-login` 路由。

---

## 📊 运维命令

```bash
# 查看日志
pm2 logs penalty-platform

# 重启服务
pm2 restart penalty-platform

# 停止服务
pm2 stop penalty-platform

# 查看服务状态
pm2 status

# 监控资源使用
pm2 monit

# 备份数据
cd /opt/penalty-warning-platform
tar czf backup-$(date +%Y%m%d).tar.gz data/
```

---

## 🔒 安全建议

1. **修改默认Session密钥**: 更改 `.env` 中的 `SESSION_SECRET`
2. **限制访问IP**: 在Nginx中配置只允许企业IP访问
3. **定期备份数据**: 定时备份 `data/` 目录
4. **启用HTTPS**: 必须使用HTTPS，企微OAuth要求
5. **关闭演示登录**: 生产环境删除演示登录接口

---

## 📞 技术支持

如有问题，请联系系统管理员。
