const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 5000;

// ============ ПАПКИ ============
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
const filesDir = path.join(__dirname, 'uploads', 'files');
const voiceDir = path.join(__dirname, 'uploads', 'voice');

[dataDir, uploadsDir, filesDir, voiceDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ============ MULTER ============
const upload = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ============ NODEMAILER ============
const transporter = nodemailer.createTransport({
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    auth: {
        user: 'brolife.messenger@mail.ru',
        pass: '08O8qkzG64zXRBkTHdKB'
    }
});

// ============ ДАННЫЕ ============
let users = [], chats = [], groups = [], messages = [], codes = {};

try {
    if (fs.existsSync(path.join(dataDir, 'users.json'))) users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
    if (fs.existsSync(path.join(dataDir, 'chats.json'))) chats = JSON.parse(fs.readFileSync(path.join(dataDir, 'chats.json'), 'utf8'));
    if (fs.existsSync(path.join(dataDir, 'groups.json'))) groups = JSON.parse(fs.readFileSync(path.join(dataDir, 'groups.json'), 'utf8'));
    if (fs.existsSync(path.join(dataDir, 'messages.json'))) messages = JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8'));
    console.log('📂 Данные загружены');
} catch (err) {
    console.log('🆕 Новая база');
}

function saveData() {
    fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
    fs.writeFileSync(path.join(dataDir, 'chats.json'), JSON.stringify(chats, null, 2));
    fs.writeFileSync(path.join(dataDir, 'groups.json'), JSON.stringify(groups, null, 2));
    fs.writeFileSync(path.join(dataDir, 'messages.json'), JSON.stringify(messages, null, 2));
}

const activeSockets = {};

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads/files', express.static(filesDir));
app.use('/uploads/voice', express.static(voiceDir));

// ============ API: ОТПРАВКА КОДА НА ПОЧТУ ============
app.post('/api/auth/sendCode', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Введите email' });
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    codes[email] = { code, expiresAt: Date.now() + 10 * 60 * 1000 };
    
    try {
        await transporter.sendMail({
            from: 'BroLife 🌿 <brolife.messenger@mail.ru>',
            to: email,
            subject: 'Код подтверждения BroLife',
            html: '<div style="text-align:center;font-family:Arial;padding:20px;"><h1 style="color:#2e7d32;">🌿 BroLife</h1><p>Ваш код подтверждения:</p><h2 style="font-size:36px;color:#2e7d32;letter-spacing:4px;">' + code + '</h2><p>Код действителен 10 минут</p></div>'
        });
        
        console.log('📧 Код отправлен на ' + email + ': ' + code);
        res.json({ success: true, message: 'Код отправлен на почту' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка отправки. Попробуйте позже.' });
    }
});

// ============ API: ПРОВЕРКА КОДА ============
app.post('/api/auth/verifyCode', (req, res) => {
    const { email, code } = req.body;
    const data = codes[email];
    
    if (!data) return res.status(400).json({ error: 'Сначала запросите код' });
    if (Date.now() > data.expiresAt) {
        delete codes[email];
        return res.status(400).json({ error: 'Код истёк. Запросите новый' });
    }
    if (data.code !== code) return res.status(400).json({ error: 'Неверный код' });
    
    delete codes[email];
    
    const existingUser = users.find(u => u.email === email);
    res.json({ success: true, isNewUser: !existingUser, user: existingUser || null });
});

// ============ API: РЕГИСТРАЦИЯ ============
app.post('/api/auth/register', upload.single('avatar'), (req, res) => {
    const { username, password, displayName, email, phone } = req.body;
    
    if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Логин занят' });
    
    const newUser = {
        id: Date.now().toString(),
        username,
        password,
        displayName: displayName || username,
        email: email || '',
        phone: phone || '',
        avatar: req.file ? '/uploads/' + req.file.filename : null,
        bio: '',
        status: 'offline',
        lastSeen: new Date().toISOString()
    };
    
    users.push(newUser);
    saveData();
    
    res.json({ success: true, user: getUserPublic(newUser) });
});

// ============ API: ВХОД ============
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    res.json({ success: true, user: getUserPublic(user) });
});

// ============ API: ВХОД ПО EMAIL ============
app.post('/api/auth/loginByEmail', (req, res) => {
    const user = users.find(u => u.email === req.body.email);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true, user: getUserPublic(user) });
});

// ============ API: ВХОД ПО ТЕЛЕФОНУ ============
app.post('/api/auth/loginByPhone', (req, res) => {
    const user = users.find(u => u.phone === req.body.phone);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true, user: getUserPublic(user) });
});

function getUserPublic(user) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar ? 'http://localhost:5000' + user.avatar : null,
        bio: user.bio,
        status: user.status,
        lastSeen: user.lastSeen
    };
}

// ============ API: ПОЛЬЗОВАТЕЛИ ============
app.get('/api/users/:userId', (req, res) => {
    res.json(users.filter(u => u.id !== req.params.userId).map(getUserPublic));
});

app.get('/api/user/:userId', (req, res) => {
    const user = users.find(u => u.id === req.params.userId);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json(getUserPublic(user));
});

// ============ API: ЧАТЫ ============
app.get('/api/chats/:userId', (req, res) => {
    const privateChats = chats
        .filter(c => c.type !== 'group' && c.participants.includes(req.params.userId))
        .map(chat => {
            const otherId = chat.participants.find(p => p !== req.params.userId);
            const otherUser = users.find(u => u.id === otherId);
            if (!otherUser) return null;
            const lastMsg = messages.filter(m => m.chatId === chat.id).sort((a, b) => b.timestamp - a.timestamp)[0];
            return {
                id: chat.id,
                type: 'private',
                otherUser: getUserPublic(otherUser),
                lastMessage: lastMsg || null,
                updatedAt: chat.updatedAt
            };
        })
        .filter(Boolean);
    
    const groupChats = groups
        .filter(g => g.participants.includes(req.params.userId))
        .map(group => {
            const lastMsg = messages.filter(m => m.chatId === group.id).sort((a, b) => b.timestamp - a.timestamp)[0];
            return {
                id: group.id,
                type: 'group',
                groupName: group.name,
                groupAvatar: group.avatar,
                lastMessage: lastMsg || null,
                updatedAt: group.updatedAt
            };
        });
    
    res.json([...privateChats, ...groupChats].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

app.get('/api/messages/:chatId', (req, res) => {
    const msgs = messages
        .filter(m => m.chatId === req.params.chatId)
        .map(m => {
            const sender = users.find(u => u.id === m.senderId);
            return { ...m, sender: sender ? getUserPublic(sender) : null };
        });
    res.json(msgs);
});

// ============ API: ЗАГРУЗКА ============
app.post('/api/upload', upload.single('file'), (req, res) => {
    res.json({ url: 'http://localhost:5000/uploads/' + req.file.filename });
});

app.post('/api/upload/voice', upload.single('voice'), (req, res) => {
    res.json({ url: 'http://localhost:5000/uploads/' + req.file.filename });
});

// ============ API: ГРУППЫ ============
app.post('/api/groups', upload.single('avatar'), (req, res) => {
    const { name, creatorId, participants } = req.body;
    const parts = JSON.parse(participants || '[]');
    parts.push(creatorId);
    const group = {
        id: 'group-' + Date.now(),
        name,
        avatar: req.file ? '/uploads/' + req.file.filename : null,
        creatorId,
        participants: [...new Set(parts)],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    groups.push(group);
    saveData();
    res.json({ success: true, group });
});

// ============ SOCKET.IO ============
io.on('connection', socket => {
    socket.on('authenticate', userId => {
        activeSockets[userId] = socket.id;
        socket.userId = userId;
        const user = users.find(u => u.id === userId);
        if (user) {
            user.status = 'online';
            saveData();
        }
        io.emit('userStatus', { userId, status: 'online' });
    });
    
    socket.on('sendMessage', data => {
        const msg = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            chatId: data.chatId,
            senderId: data.senderId,
            text: data.text || '',
            type: data.type || 'text',
            fileUrl: data.fileUrl || null,
            fileName: data.fileName || null,
            timestamp: new Date().toISOString()
        };
        messages.push(msg);
        saveData();
        
        const sender = getUserPublic(users.find(u => u.id === data.senderId));
        const msgData = { ...msg, sender };
        
        if (data.isGroup) {
            const group = groups.find(g => g.id === data.chatId);
            if (group) {
                group.updatedAt = new Date().toISOString();
                group.participants.forEach(pid => {
                    if (pid !== data.senderId && activeSockets[pid]) {
                        io.to(activeSockets[pid]).emit('newMessage', msgData);
                    }
                });
            }
        } else if (data.receiverId && activeSockets[data.receiverId]) {
            io.to(activeSockets[data.receiverId]).emit('newMessage', msgData);
        }
        
        socket.emit('messageSent', msgData);
        io.emit('chatUpdated', { chatId: data.chatId });
    });
    
    socket.on('disconnect', () => {
        if (socket.userId) {
            delete activeSockets[socket.userId];
            const user = users.find(u => u.id === socket.userId);
            if (user) {
                user.status = 'offline';
                user.lastSeen = new Date().toISOString();
                saveData();
            }
            io.emit('userStatus', { userId: socket.userId, status: 'offline' });
        }
    });
});
app.get('/debug', (req, res) => {
    const fs = require('fs');
    const files = fs.readdirSync(path.join(__dirname, 'client'));
    res.json({ files: files });
});
// ============ СТАТИЧЕСКИЕ ФАЙЛЫ (В САМОМ КОНЦЕ) ============
app.use(express.static(path.join(__dirname, 'client')));

// ============ ЗАПУСК ============
server.listen(PORT, () => console.log('🌿 BroLife Server: http://localhost:' + PORT));