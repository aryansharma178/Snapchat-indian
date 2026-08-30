const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

app.use(express.json());

app.post('/api/auth/login', (req, res) => {
    const { name, username } = req.body;
    if (!name || !username) {
        return res.json({ success: false, message: 'Name and username are required' });
    }
    res.json({ success: true, user: { name, username } });
});

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle chat messages / snaps
    socket.on('send_snap', (data) => {
        io.emit('receive_snap', data);
    });

    // Handle Screenshot & Screen Recording alerts
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
