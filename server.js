const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// In-memory user database
const users = [];

app.post('/api/auth/login', (req, res) => {
    const { name, username } = req.body;
    if (!name || !username) {
        return res.json({ success: false, message: 'Name and username are required' });
    }
    
    // Check if user already exists, else register
    let user = users.find(u => u.username === username);
    if (!user) {
        user = { name, username, id: socketId => socketId };
        users.push(user);
    }
    res.json({ success: true, user });
});

// Search API for finding user IDs across phones
app.get('/api/users/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase();
    const matchedUsers = users.filter(u => 
        u.username.toLowerCase().includes(query) || 
        u.name.toLowerCase().includes(query)
    );
    res.json({ success: true, users: matchedUsers });
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('send_snap', (data) => {
        io.emit('receive_snap', data);
    });

    socket.on('security_alert', (data) => {
        io.emit('receive_security_alert', data);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Jhapki server running on port ${PORT}`);
});
