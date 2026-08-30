const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new DatabaseSync('./snapchat.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        message TEXT,
        image TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('online_count', onlineUsers);
    console.log('User connected:', socket.id);

    socket.on('send_snap', (data) => {
        io.emit('receive_snap', data);
    });

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('online_count', onlineUsers);
        console.log('User disconnected:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});

