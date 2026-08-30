const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new DatabaseSync('./snapchat.db');

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

/* =========================
   DATABASE
========================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    username TEXT UNIQUE,
    password_hash TEXT,
    verified INTEGER DEFAULT 0,
    data_allowed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================
   OTP
========================= */

function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
}

function hashOTP(otp) {
    return crypto
        .createHash('sha256')
        .update(otp)
        .digest('hex');
}

/* =========================
   TEXTPLATE
========================= */

function sendTextplateOTP(phone, otp) {

    return new Promise((resolve, reject) => {

        const apiKey = process.env.TEXTPLATE_API_KEY;
        const templateId = process.env.TEXTPLATE_TEMPLATE_ID;

        if (!apiKey) {
            return reject(
                new Error('TEXTPLATE_API_KEY is not set')
            );
        }

        if (!templateId) {
            return reject(
                new Error('TEXTPLATE_TEMPLATE_ID is not set')
            );
        }

        const boundary =
            '----SnapchatIndian' +
            crypto.randomBytes(12).toString('hex');

        const parts = [];

        function addField(name, value) {

            parts.push(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
                `${value}\r\n`
            );
        }

        addField(
            'mobileNumber',
            phone.startsWith('+') ? phone : '+91' + phone
        );

        addField(
            'templateId',
            templateId
        );

        addField(
            'otpValue',
            otp
        );

        addField(
            'expiryValue',
            '5 minutes'
        );

        const body = Buffer.from(
            parts.join('') +
            `--${boundary}--\r\n`
        );

        const request = https.request({
            hostname: 'api.textplate.in',
            path: '/v1/send-sms',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':
                    `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        }, response => {

            let responseBody = '';

            response.on('data', chunk => {
                responseBody += chunk;
            });

            response.on('end', () => {

                console.log(
                    'TEXTPLATE HTTP STATUS:',
                    response.statusCode
                );

                console.log(
                    'TEXTPLATE RESPONSE:',
                    responseBody
                );

                let result;

                try {
                    result = JSON.parse(responseBody);
                } catch {
                    result = {
                        raw: responseBody
                    };
                }

                if (
                    response.statusCode >= 200 &&
                    response.statusCode < 300
                ) {
                    resolve(result);
                } else {
                    reject(
                        new Error(
                            `Textplate HTTP ${response.statusCode}`
                        )
                    );
                }
            });
        });

        request.on('error', error => {
            reject(error);
        });

        request.write(body);
        request.end();
    });
}

/* =========================
   SEND OTP
========================= */

app.post('/api/auth/send-otp', async (req, res) => {

    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({
            success: false,
            message: 'Phone number is required'
        });
    }

    const cleanPhone =
        phone.replace(/\D/g, '');

    if (
        cleanPhone.length < 10 ||
        cleanPhone.length > 15
    ) {
        return res.status(400).json({
            success: false,
            message: 'Invalid phone number'
        });
    }

    db.prepare(`
        DELETE FROM otp_codes
        WHERE phone = ?
    `).run(cleanPhone);

    const otp = generateOTP();

    const otpHash = hashOTP(otp);

    const expiresAt =
        Date.now() + (5 * 60 * 1000);

    db.prepare(`
        INSERT INTO otp_codes
        (phone, otp_hash, expires_at)
        VALUES (?, ?, ?)
    `).run(
        cleanPhone,
        otpHash,
        expiresAt
    );

    try {

        const result =
            await sendTextplateOTP(
                cleanPhone,
                otp
            );

        console.log(
            'OTP SMS request completed for:',
            cleanPhone
        );

        res.json({
            success: true,
            message: 'OTP sent successfully',
            provider: result
        });

    } catch (error) {

        db.prepare(`
            DELETE FROM otp_codes
            WHERE phone = ?
        `).run(cleanPhone);

        console.error(
            'TEXTPLATE ERROR:',
            error.message
        );

        res.status(500).json({
            success: false,
            message: 'Unable to send OTP SMS'
        });
    }
});

/* =========================
   VERIFY OTP
========================= */

app.post('/api/auth/verify-otp', (req, res) => {

    const {
        phone,
        otp,
        name,
        username
    } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({
            success: false,
            message:
                'Phone number and OTP are required'
        });
    }

    const cleanPhone =
        phone.replace(/\D/g, '');

    const record = db.prepare(`
        SELECT *
        FROM otp_codes
        WHERE phone = ?
        ORDER BY id DESC
        LIMIT 1
    `).get(cleanPhone);

    if (!record) {
        return res.status(400).json({
            success: false,
            message:
                'OTP not found. Please request a new OTP.'
        });
    }

    if (Date.now() > record.expires_at) {

        db.prepare(`
            DELETE FROM otp_codes
            WHERE id = ?
        `).run(record.id);

        return res.status(400).json({
            success: false,
            message:
                'OTP expired. Please request a new OTP.'
        });
    }

    if (record.attempts >= 5) {
        return res.status(429).json({
            success: false,
            message:
                'Too many attempts. Please request a new OTP.'
        });
    }

    const enteredHash =
        hashOTP(otp.toString());

    if (enteredHash !== record.otp_hash) {

        db.prepare(`
            UPDATE otp_codes
            SET attempts = attempts + 1
            WHERE id = ?
        `).run(record.id);

        return res.status(400).json({
            success: false,
            message: 'Invalid OTP'
        });
    }

    db.prepare(`
        DELETE FROM otp_codes
        WHERE id = ?
    `).run(record.id);

    let user = db.prepare(`
        SELECT *
        FROM users
        WHERE phone = ?
    `).get(cleanPhone);

    if (!user) {

        try {

            const result = db.prepare(`
                INSERT INTO users
                (phone, name, username, verified)
                VALUES (?, ?, ?, 1)
            `).run(
                cleanPhone,
                name || null,
                username || null
            );

            user = db.prepare(`
                SELECT *
                FROM users
                WHERE id = ?
            `).get(
                Number(result.lastInsertRowid)
            );

        } catch (error) {

            return res.status(400).json({
                success: false,
                message:
                    'Username may already be in use'
            });
        }

    } else {

        db.prepare(`
            UPDATE users
            SET
                verified = 1,
                name = COALESCE(?, name),
                username = COALESCE(?, username)
            WHERE phone = ?
        `).run(
            name || null,
            username || null,
            cleanPhone
        );

        user = db.prepare(`
            SELECT *
            FROM users
            WHERE phone = ?
        `).get(cleanPhone);
    }

    res.json({
        success: true,
        message:
            'Phone verified successfully',
        user: {
            id: user.id,
            phone: user.phone,
            name: user.name,
            username: user.username,
            verified: true,
            dataAllowed:
                Boolean(user.data_allowed)
        }
    });
});

/* =========================
   ALLOW DATA
========================= */

app.post('/api/auth/allow-data', (req, res) => {

    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({
            success: false,
            message: 'Phone number is required'
        });
    }

    const cleanPhone =
        phone.replace(/\D/g, '');

    const user = db.prepare(`
        SELECT *
        FROM users
        WHERE phone = ?
    `).get(cleanPhone);

    if (!user || !user.verified) {
        return res.status(403).json({
            success: false,
            message:
                'Phone verification required'
        });
    }

    db.prepare(`
        UPDATE users
        SET data_allowed = 1
        WHERE phone = ?
    `).run(cleanPhone);

    res.json({
        success: true,
        message:
            'Data permission saved'
    });
});

/* =========================
   SOCKET.IO
========================= */

let onlineUsers = 0;

io.on('connection', socket => {

    onlineUsers++;

    io.emit(
        'online_count',
        onlineUsers
    );

    console.log(
        'User connected:',
        socket.id
    );

    socket.on('send_snap', data => {

        if (!data) return;

        const sender =
            String(data.sender || '')
                .slice(0, 100);

        const message =
            String(data.message || '')
                .slice(0, 5000);

        if (!sender || !message) {
            return;
        }

        db.prepare(`
            INSERT INTO messages
            (sender, message)
            VALUES (?, ?)
        `).run(
            sender,
            message
        );

        io.emit(
            'receive_snap',
            {
                sender,
                message
            }
        );
    });

    socket.on('disconnect', () => {

        onlineUsers--;

        if (onlineUsers < 0) {
            onlineUsers = 0;
        }

        io.emit(
            'online_count',
            onlineUsers
        );

        console.log(
            'User disconnected:',
            socket.id
        );
    });
});

/* =========================
   SERVER
========================= */

server.listen(3000, () => {

    console.log('================================');
    console.log(
        'Snapchat Indian Server Started'
    );
    console.log(
        'http://localhost:3000'
    );
    console.log('================================');
});
