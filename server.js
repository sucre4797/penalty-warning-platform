/**
 * 行政处罚预警平台 - 后端服务
 * 功能：政府检查事件管理、行政处罚挂网监控
 * 特性：企业微信OAuth登录、会话管理、公网部署
 * 
 * 环境变量配置：
 * - WECHAT_CORPID: 企业微信CorpID
 * - WECHAT_AGENTID: 企业微信应用AgentID
 * - WECHAT_SECRET: 企业微信应用Secret
 * - BASE_URL: 应用公网访问地址 (如: https://your-domain.com)
 * - PORT: 服务端口 (默认: 5500)
 * - SESSION_SECRET: Session加密密钥
 */

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const schedule = require('node-schedule');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5500;

// 自动检测 BASE_URL
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const BASE_URL = process.env.BASE_URL || RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// ==================== 企业微信配置 ====================
const WECHAT_CONFIG = {
    corpId: process.env.WECHAT_CORPID || '',
    agentId: process.env.WECHAT_AGENTID || '',
    secret: process.env.WECHAT_SECRET || '',
    baseUrl: BASE_URL,
    // 企业微信OAuth授权地址
    getAuthUrl(redirectUri, state = '') {
        const encodedUri = encodeURIComponent(redirectUri);
        return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${this.corpId}&redirect_uri=${encodedUri}&response_type=code&scope=snsapi_base&state=${state}#wechat_redirect`;
    }
};

// ==================== 中间件配置 ====================
app.use(cookieParser());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Session配置
app.use(session({
    secret: process.env.SESSION_SECRET || 'penalty-warning-platform-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // 生产环境如果使用HTTPS请设为true
        maxAge: 24 * 60 * 60 * 1000 // 24小时
    }
}));

// CORS配置
app.use(cors({
    origin: true,
    credentials: true
}));

// ==================== 数据目录 ====================
const DATA_DIR = path.join(__dirname, 'data');
const INSPECTION_FILE = path.join(DATA_DIR, 'inspection_events.json');
const PENALTY_FILE = path.join(DATA_DIR, 'penalty_events.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// 确保目录存在
[DATA_DIR, UPLOADS_DIR, SESSIONS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 区域和阵地数据
const REGIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const POSITIONS = [
    'A58', 'A64', 'A71', 'A72', 'A73', 'A31', 'A51', 'A52', 'A53', 'A54', 
    'A55', 'A56', 'A57', 'A61', 'A62', 'A63', 'A81', 'A82', 'A83', 'V01',
    'B51', 'B52', 'B53', 'B54', 'B55', 'B56', 'B57', 'B58', 'B60', 'B61', 
    'B62', 'B63', 'B71', 'B72', 'B73', 'B74', 'B75', 'B91', 'B92', 'V02',
    'C51', 'C52', 'C53', 'C54', 'C55', 'C56', 'C57', 'C58', 'C61', 'C62', 
    'C63', 'C64', 'D51', 'D52', 'D53', 'D54', 'D55', 'D56', 'D57', 'D61', 
    'D62', 'D63', 'D64', 'D65', 'D66', 'D67', 'D71', 'D72', 'D73', 'D74', 
    'D75', 'D76', 'V03', 'E51', 'E52', 'E53', 'E54', 'E55', 'E56', 'E57', 
    'E61', 'E62', 'E63', 'E64', 'E65', 'E71', 'E72', 'E73', 'F51', 'F52', 
    'F53', 'F54', 'F55', 'F56', 'F57', 'F58', 'F59', 'F60', 'F71', 'F72', 
    'F73', 'F74', 'F75', 'F76', 'G51', 'G52', 'G53', 'G54', 'G55', 'G56', 
    'G57', 'G58', 'G61', 'G62', 'G63', 'G64', 'G65', 'G71', 'G72', 'G73', 
    'G74', 'G75', 'H51', 'H52', 'H53', 'H54', 'H55', 'H56', 'H57', 'H58', 
    'H61', 'H62', 'H63', 'H64', 'H65', 'H66', 'B32'
];

// 文件上传配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        cb(null, `${timestamp}_${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// ==================== 登录验证中间件 ====================

// 检查是否已登录
function requireAuth(req, res, next) {
    // 跳过登录相关路由
    const publicPaths = [
        '/login', 
        '/login.html',
        '/api/wechat/config',
        '/api/wechat/auth', 
        '/api/wechat/callback', 
        '/api/wechat/userinfo',
        '/api/check-auth',
        '/api/demo-login'
    ];
    if (publicPaths.includes(req.path)) {
        return next();
    }
    
    // API路由需要登录
    if (req.path.startsWith('/api/')) {
        if (req.session && req.session.user) {
            return next();
        }
        return res.status(401).json({ success: false, message: '请先登录', code: 'UNAUTHORIZED' });
    }
    
    // 页面路由需要登录
    if (req.session && req.session.user) {
        return next();
    }
    
    // 未登录重定向到登录页
    res.redirect('/login.html');
}

// 应用登录验证
app.use(requireAuth);

// ==================== 数据管理函数 ====================

function loadData(filePath, defaultData = []) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`读取数据文件失败: ${filePath}`, error);
    }
    return defaultData;
}

function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`保存数据文件失败: ${filePath}`, error);
        return false;
    }
}

// 获取区域编号
function getRegionCode(positionCode) {
    if (!positionCode) return '';
    return positionCode.charAt(0).toUpperCase();
}

// ==================== 企业微信登录路由 ====================

// 获取登录配置（前端调用）
app.get('/api/wechat/config', (req, res) => {
    res.json({
        success: true,
        corpId: WECHAT_CONFIG.corpId,
        agentId: WECHAT_CONFIG.agentId,
        enabled: !!(WECHAT_CONFIG.corpId && WECHAT_CONFIG.agentId)
    });
});

// 企微OAuth授权跳转
app.get('/api/wechat/auth', (req, res) => {
    if (!WECHAT_CONFIG.corpId || !WECHAT_CONFIG.agentId) {
        return res.status(500).json({ 
            success: false, 
            message: '企业微信登录未配置，请设置WECHAT_CORPID和WECHAT_AGENTID环境变量' 
        });
    }
    
    const redirectUri = `${WECHAT_CONFIG.baseUrl}/api/wechat/callback`;
    const state = req.query.redirect || '/';
    const authUrl = WECHAT_CONFIG.getAuthUrl(redirectUri, state);
    
    res.redirect(authUrl);
});

// 企微OAuth回调处理
app.get('/api/wechat/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.redirect('/login.html?error=授权失败，未获取到授权码');
    }
    
    try {
        // 1. 获取access_token
        const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECHAT_CONFIG.corpId}&corpsecret=${WECHAT_CONFIG.secret}`;
        const tokenRes = await axios.get(tokenUrl);
        
        if (tokenRes.data.errcode !== 0) {
            console.error('获取access_token失败:', tokenRes.data);
            return res.redirect('/login.html?error=企业微信配置错误，请联系管理员');
        }
        
        const accessToken = tokenRes.data.access_token;
        
        // 2. 获取用户信息
        const userUrl = `https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${accessToken}&code=${code}`;
        const userRes = await axios.get(userUrl);
        
        if (userRes.data.errcode !== 0) {
            console.error('获取用户信息失败:', userRes.data);
            return res.redirect('/login.html?error=获取用户信息失败');
        }
        
        const userId = userRes.data.UserId || userRes.data.userid;
        
        if (!userId) {
            return res.redirect('/login.html?error=未获取到用户ID');
        }
        
        // 3. 获取用户详细信息
        const userInfoUrl = `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${userId}`;
        const userInfoRes = await axios.get(userInfoUrl);
        
        let userInfo = {
            userId: userId,
            name: userId,
            avatar: '',
            department: [],
            loginTime: new Date().toISOString()
        };
        
        if (userInfoRes.data.errcode === 0) {
            userInfo.name = userInfoRes.data.name || userId;
            userInfo.avatar = userInfoRes.data.avatar || '';
            userInfo.department = userInfoRes.data.department || [];
            userInfo.mobile = userInfoRes.data.mobile || '';
            userInfo.email = userInfoRes.data.email || '';
        }
        
        // 4. 保存会话
        req.session.user = userInfo;
        req.session.isAuthenticated = true;
        
        // 5. 记录登录日志
        const loginLog = loadData(path.join(DATA_DIR, 'login_logs.json'), []);
        loginLog.push({
            userId: userInfo.userId,
            name: userInfo.name,
            loginTime: new Date().toISOString(),
            ip: req.ip
        });
        saveData(path.join(DATA_DIR, 'login_logs.json'), loginLog.slice(-1000)); // 保留最近1000条
        
        // 6. 跳转到原页面或首页
        const redirect = state || '/';
        res.redirect(redirect);
        
    } catch (error) {
        console.error('企微登录处理错误:', error);
        res.redirect('/login.html?error=登录处理失败，请稍后重试');
    }
});

// 获取当前登录用户信息
app.get('/api/user/info', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            success: true,
            user: req.session.user,
            isAuthenticated: true
        });
    } else {
        res.status(401).json({
            success: false,
            message: '未登录',
            isAuthenticated: false
        });
    }
});

// 退出登录
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.json({ success: false, message: '退出失败' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: '已退出登录' });
    });
});

// 演示登录（开发测试用，生产环境建议禁用）
app.post('/api/demo-login', (req, res) => {
    const demoUser = {
        userId: 'demo_user',
        name: '演示用户',
        avatar: '',
        department: ['测试部门'],
        mobile: '13800138000',
        email: 'demo@example.com',
        loginTime: new Date().toISOString(),
        isDemo: true
    };
    
    req.session.user = demoUser;
    req.session.isAuthenticated = true;
    
    res.json({ success: true, message: '演示登录成功', user: demoUser });
});

// 检查是否已登录（前端轮询用）
app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ 
            success: true, 
            isAuthenticated: true, 
            user: req.session.user 
        });
    } else {
        res.json({ 
            success: true, 
            isAuthenticated: false 
        });
    }
});

// ==================== API路由 ====================

// 获取区域和阵地列表
app.get('/api/metadata', (req, res) => {
    res.json({
        regions: REGIONS,
        positions: POSITIONS
    });
});

// ==================== 数据源一：政府检查事件 ====================

// 上传政府检查事件文件
app.post('/api/inspection/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未上传文件' });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) {
            return res.status(400).json({ success: false, message: '文件为空' });
        }

        let existingData = loadData(INSPECTION_FILE, []);
        let addedCount = 0;
        let updatedCount = 0;
        const existingCodes = new Set(existingData.map(item => item['事件编码']));

        jsonData.forEach(row => {
            // 字段映射
            const eventCode = row['事件编码'] || row['事件编号'];
            if (!eventCode) return;

            const eventData = {
                '城市': row['城市'] || '',
                '区域编号': row['区域编号'] || getRegionCode(row['阵地编号']),
                '阵地编号': row['阵地编号'] || '',
                '报事时间': row['报事时间'] || '',
                '事发时间': row['事发时间'] || '',
                '事件编码': eventCode,
                '报事组织': row['报事组织'] || '',
                '事件主题': row['事件主题'] || '',
                '核心信息': row['核心信息'] || '',
                '详细信息': row['详细信息'] || '',
                '事件分类': row['事件分类'] || '',
                '检查部门名称': row['检查部门的名称'] || row['检查部门名称'] || '',
                '所属行政级别': row['所属行政级别'] || '',
                '检查结果是否合格': row['检查结果是否合格'] || '',
                '不合格项': row['不合格项'] || '',
                '是否涉及行政处罚风险': row['是否涉及行政处罚风险'] || '',
                '处罚金额': row['处罚金额'] || '',
                '整改是否涉及第三方': row['整改是否涉及第三方'] || '',
                '是否知会第三方': row['是否知会第三方'] || '',
                '是否下发纸质文件': row['是否下发纸质文件'] || '',
                '政府是否要求回函': row['政府是否要求回函'] || '',
                '政府要求整改截止日期': row['政府要求整改截止日期'] || '',
                '能否按时完成整改': row['能否按时完成整改'] || '',
                '调度详情': row['调度详情'] || '',
                // 可编辑字段
                '阵地对接人初次评估': row['阵地对接人初次评估'] || '',
                '阵地对接人二次评估': row['阵地对接人二次评估'] || '',
                '初次评估日期': row['初次评估日期'] || '',
                '二次评估日期': row['二次评估日期'] || '',
                '评估说明': row['评估说明'] || '',
                // 系统字段
                '导入时间': new Date().toISOString(),
                '数据来源': '文件上传',
                '上传人': req.session.user ? req.session.user.name : '系统'
            };

            const existingIndex = existingData.findIndex(item => item['事件编码'] === eventCode);
            if (existingIndex >= 0) {
                // 更新保留可编辑字段
                const editableFields = ['阵地对接人初次评估', '阵地对接人二次评估', '初次评估日期', '二次评估日期', '评估说明'];
                editableFields.forEach(field => {
                    if (existingData[existingIndex][field]) {
                        eventData[field] = existingData[existingIndex][field];
                    }
                });
                existingData[existingIndex] = { ...existingData[existingIndex], ...eventData };
                updatedCount++;
            } else {
                existingData.push(eventData);
                addedCount++;
            }
        });

        saveData(INSPECTION_FILE, existingData);

        // 删除临时文件
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `导入成功，新增 ${addedCount} 条，更新 ${updatedCount} 条`,
            added: addedCount,
            updated: updatedCount,
            total: existingData.length
        });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ success: false, message: '上传失败: ' + error.message });
    }
});

// 获取政府检查事件列表
app.get('/api/inspection/events', (req, res) => {
    let data = loadData(INSPECTION_FILE, []);
    
    // 筛选
    const { region, position, startDate, endDate, qualified, keyword } = req.query;
    
    if (region && region !== 'all') {
        data = data.filter(item => item['区域编号'] === region);
    }
    if (position && position !== 'all') {
        data = data.filter(item => item['阵地编号'] === position);
    }
    if (startDate) {
        data = data.filter(item => item['报事时间'] >= startDate);
    }
    if (endDate) {
        data = data.filter(item => item['报事时间'] <= endDate);
    }
    if (qualified) {
        data = data.filter(item => item['检查结果是否合格'] === qualified);
    }
    if (keyword) {
        const kw = keyword.toLowerCase();
        data = data.filter(item => 
            (item['城市'] && item['城市'].toLowerCase().includes(kw)) ||
            (item['事件编码'] && item['事件编码'].toLowerCase().includes(kw)) ||
            (item['核心信息'] && item['核心信息'].toLowerCase().includes(kw))
        );
    }

    // 排序：报事时间降序，区域编号，阵地编号
    data.sort((a, b) => {
        const timeCompare = new Date(b['报事时间'] || 0) - new Date(a['报事时间'] || 0);
        if (timeCompare !== 0) return timeCompare;
        const regionCompare = (a['区域编号'] || '').localeCompare(b['区域编号'] || '');
        if (regionCompare !== 0) return regionCompare;
        return (a['阵地编号'] || '').localeCompare(b['阵地编号'] || '');
    });

    res.json({ success: true, data, total: data.length });
});

// 更新事件评估信息
app.post('/api/inspection/evaluate/:eventCode', (req, res) => {
    const { eventCode } = req.params;
    const { firstAssessment, secondAssessment, assessmentNote } = req.body;
    
    let data = loadData(INSPECTION_FILE, []);
    const index = data.findIndex(item => item['事件编码'] === eventCode);
    
    if (index < 0) {
        return res.status(404).json({ success: false, message: '事件不存在' });
    }

    const now = new Date().toISOString().split('T')[0];
    const operator = req.session.user ? req.session.user.name : '系统';
    
    if (firstAssessment !== undefined) {
        data[index]['阵地对接人初次评估'] = firstAssessment;
        if (firstAssessment && !data[index]['初次评估日期']) {
            data[index]['初次评估日期'] = now;
        }
    }
    if (secondAssessment !== undefined) {
        data[index]['阵地对接人二次评估'] = secondAssessment;
        if (secondAssessment && !data[index]['二次评估日期']) {
            data[index]['二次评估日期'] = now;
        }
    }
    if (assessmentNote !== undefined) {
        data[index]['评估说明'] = assessmentNote;
    }
    
    // 记录最后修改人
    data[index]['最后修改人'] = operator;
    data[index]['最后修改时间'] = new Date().toISOString();

    saveData(INSPECTION_FILE, data);
    res.json({ success: true, message: '更新成功', data: data[index] });
});

// 模块2：近三日新增不合格检查
app.get('/api/inspection/recent-unqualified', (req, res) => {
    let data = loadData(INSPECTION_FILE, []);
    
    // 筛选不合格
    data = data.filter(item => item['检查结果是否合格'] === '不合格');
    
    // 筛选近3天（报事时间）
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    data = data.filter(item => {
        if (!item['报事时间']) return false;
        const reportDate = new Date(item['报事时间']);
        return reportDate >= threeDaysAgo;
    });

    // 筛选
    const { region, position } = req.query;
    if (region && region !== 'all') {
        data = data.filter(item => item['区域编号'] === region);
    }
    if (position && position !== 'all') {
        data = data.filter(item => item['阵地编号'] === position);
    }

    // 排序
    data.sort((a, b) => {
        const timeCompare = new Date(b['报事时间'] || 0) - new Date(a['报事时间'] || 0);
        if (timeCompare !== 0) return timeCompare;
        const regionCompare = (a['区域编号'] || '').localeCompare(b['区域编号'] || '');
        if (regionCompare !== 0) return regionCompare;
        return (a['阵地编号'] || '').localeCompare(b['阵地编号'] || '');
    });

    res.json({ success: true, data, total: data.length });
});

// 模块3：临近整改日期未闭环事件
app.get('/api/inspection/urgent-deadline', (req, res) => {
    let data = loadData(INSPECTION_FILE, []);
    const today = new Date();
    const tenDaysLater = new Date();
    tenDaysLater.setDate(today.getDate() + 10);

    data = data.filter(item => {
        const deadline = item['政府要求整改截止日期'];
        if (!deadline) return false;
        
        const deadlineDate = new Date(deadline);
        // 截止日期距离今天小于10天
        if (deadlineDate > tenDaysLater || deadlineDate < today) return false;

        const first = item['阵地对接人初次评估'];
        const second = item['阵地对接人二次评估'];

        // 最新评估存在行政处罚风险
        if (second === '存在行政处罚风险') return true;
        if (!second && first === '存在行政处罚风险') return true;
        
        return false;
    });

    // 筛选
    const { region, position } = req.query;
    if (region && region !== 'all') {
        data = data.filter(item => item['区域编号'] === region);
    }
    if (position && position !== 'all') {
        data = data.filter(item => item['阵地编号'] === position);
    }

    // 排序
    data.sort((a, b) => {
        const deadlineA = new Date(a['政府要求整改截止日期'] || '9999-12-31');
        const deadlineB = new Date(b['政府要求整改截止日期'] || '9999-12-31');
        return deadlineA - deadlineB;
    });

    res.json({ success: true, data, total: data.length });
});

// ==================== 数据源二：行政处罚事件 ====================

// 从腾讯文档同步数据
async function syncPenaltyDataFromWeChatDoc() {
    try {
        console.log('尝试同步腾讯文档数据...', new Date().toLocaleString());
        return { success: false, message: '腾讯文档API需要配置访问密钥' };
    } catch (error) {
        console.error('同步腾讯文档失败:', error);
        return { success: false, message: error.message };
    }
}

// 手动触发同步
app.post('/api/penalty/sync', async (req, res) => {
    const result = await syncPenaltyDataFromWeChatDoc();
    res.json(result);
});

// 上传行政处罚文件
app.post('/api/penalty/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未上传文件' });
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        if (jsonData.length === 0) {
            return res.status(400).json({ success: false, message: '文件为空' });
        }

        let existingData = loadData(PENALTY_FILE, []);
        let addedCount = 0;
        let updatedCount = 0;
        const operator = req.session.user ? req.session.user.name : '系统';

        jsonData.forEach(row => {
            const docNumber = row['决定文书号'];
            if (!docNumber) return;

            const eventData = {
                '远程查询日期': row['远程查询日期'] || '',
                '项目名称': row['项目名称'] || '',
                '项目编码': row['项目编码'] || '',
                '军种': row['军种'] || '',
                '区域': row['区域'] || '',
                '阵地编码': row['阵地编码'] || '',
                '事件编号': row['事件编号'] || '',
                '企业名称': row['企业名称'] || '',
                '决定文书号': docNumber,
                '违法事实': row['违法事实'] || '',
                '处罚结果': row['处罚结果'] || '',
                '处罚金额': row['处罚金额（元）'] || row['处罚金额'] || '',
                '处罚单位': row['处罚单位'] || '',
                '处罚日期': row['处罚日期'] || '',
                // 系统字段
                '导入时间': new Date().toISOString(),
                '数据来源': '文件上传',
                '上传人': operator
            };

            const existingIndex = existingData.findIndex(item => item['决定文书号'] === docNumber);
            if (existingIndex >= 0) {
                existingData[existingIndex] = { ...existingData[existingIndex], ...eventData };
                updatedCount++;
            } else {
                existingData.push(eventData);
                addedCount++;
            }
        });

        saveData(PENALTY_FILE, existingData);
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `导入成功，新增 ${addedCount} 条，更新 ${updatedCount} 条`,
            added: addedCount,
            updated: updatedCount,
            total: existingData.length
        });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ success: false, message: '上传失败: ' + error.message });
    }
});

// 模块4：行政处罚挂网提醒（仅万科物业）
app.get('/api/penalty/events', (req, res) => {
    let data = loadData(PENALTY_FILE, []);
    
    // 筛选万科物业
    data = data.filter(item => item['军种'] === '万科物业');
    
    // 筛选
    const { region, position, startDate, endDate } = req.query;
    if (region && region !== 'all') {
        data = data.filter(item => item['区域'] === region);
    }
    if (position && position !== 'all') {
        data = data.filter(item => item['阵地编码'] === position);
    }
    if (startDate) {
        data = data.filter(item => item['处罚日期'] >= startDate);
    }
    if (endDate) {
        data = data.filter(item => item['处罚日期'] <= endDate);
    }

    // 关联检查事件的评估信息
    const inspectionData = loadData(INSPECTION_FILE, []);
    data = data.map(item => {
        const relatedInspection = inspectionData.find(
            ins => ins['事件编码'] === item['事件编号']
        );
        if (relatedInspection) {
            return {
                ...item,
                '阵地对接人初次评估': relatedInspection['阵地对接人初次评估'] || '',
                '阵地对接人二次评估': relatedInspection['阵地对接人二次评估'] || '',
                '初次评估日期': relatedInspection['初次评估日期'] || '',
                '二次评估日期': relatedInspection['二次评估日期'] || '',
                '评估说明': relatedInspection['评估说明'] || ''
            };
        }
        return item;
    });

    // 排序：处罚日期降序
    data.sort((a, b) => {
        return new Date(b['处罚日期'] || 0) - new Date(a['处罚日期'] || 0);
    });

    res.json({ success: true, data, total: data.length });
});

// 获取统计数据
app.get('/api/statistics', (req, res) => {
    const inspectionData = loadData(INSPECTION_FILE, []);
    const penaltyData = loadData(PENALTY_FILE, []);
    
    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const stats = {
        inspection: {
            total: inspectionData.length,
            unqualified: inspectionData.filter(i => i['检查结果是否合格'] === '不合格').length,
            recent3Days: inspectionData.filter(i => {
                if (!i['报事时间']) return false;
                return new Date(i['报事时间']) >= threeDaysAgo;
            }).length,
            urgentDeadline: 0
        },
        penalty: {
            total: penaltyData.filter(p => p['军种'] === '万科物业').length
        }
    };

    res.json({ success: true, stats });
});

// ==================== 定时任务 ====================

// 每天9点同步腾讯文档
schedule.scheduleJob('0 9 * * *', async () => {
    console.log('执行定时任务：同步腾讯文档数据', new Date().toLocaleString());
    await syncPenaltyDataFromWeChatDoc();
});

// ==================== 静态文件服务 ====================

// 登录页面不需要验证，已在requireAuth中排除
// 其他静态资源需要登录后才能访问
app.use(express.static('public'));

// ==================== 错误处理 ====================

app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    if (req.path.startsWith('/api/')) {
        res.status(500).json({ success: false, message: '服务器内部错误' });
    } else {
        res.status(500).send('服务器内部错误');
    }
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('  行政处罚预警平台已启动');
    console.log('='.repeat(60));
    console.log(`  访问地址: ${BASE_URL}`);
    console.log(`  登录页面: ${BASE_URL}/login.html`);
    console.log('-'.repeat(60));
    console.log('  企微登录配置:');
    console.log(`    CorpID: ${WECHAT_CONFIG.corpId || '未配置'}`);
    console.log(`    AgentID: ${WECHAT_CONFIG.agentId || '未配置'}`);
    console.log(`    Secret: ${WECHAT_CONFIG.secret ? '已配置' : '未配置'}`);
    console.log('='.repeat(60));
});
