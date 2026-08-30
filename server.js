const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

const users = {};

app.post('/api/auth/login', (req, res) => {
    const { name, username } = req.body;
    if (!name || !username) {
        return res.json({ success: false, message: 'Name and username are required' });
    }

    const userId = username;
    users[userId] = { name, username };

    return res.json({
        success: true,
        message: 'Logged in successfully',
        user: users[userId]
    });
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('send_snap', (data) => {
        io.emit('receive_snap', {
            sender: data.sender || 'Anonymous',
            message: data.message || ''
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('================================');
    console.log('Jhapki Server Started Successfully');
    console.log(`http://localhost:${PORT}`);
    console.log('================================');
});
