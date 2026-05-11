// ============================================================
// PILL REMINDER BOT — full integrated version (Steps 1-9)
// ============================================================

// Load environment variables from .env into process.env
require('dotenv').config();

const fs = require('fs');                              // built-in: read/write files
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ------------------------------------------------------------
// CONSTANTS & STATE
// ------------------------------------------------------------
const HISTORY_FILE = './history.json';

// Pills currently waiting for a YES/NO reply.
// Map<pillName, { sentAt: Date, remindersSent: number }>
const pendingReminders = new Map();

// When each pill was last fired — prevents double-firing within same minute.
// Map<pillName, Date>
const lastFiredAt = new Map();

// ------------------------------------------------------------
// LOAD PILL CONFIG
// ------------------------------------------------------------
function loadPills() {
    try {
        const fileContents = fs.readFileSync('./pills.json', 'utf8');
        const config = JSON.parse(fileContents);
        console.log(`💊 Loaded ${config.pills.length} pill(s) from pills.json`);
        return config;
    } catch (err) {
        console.error('❌ Failed to load pills.json:', err.message);
        process.exit(1);
    }
}

// ------------------------------------------------------------
// HISTORY LOG — append a record to history.json
// ------------------------------------------------------------
function logResponse(entry) {
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            const text = fs.readFileSync(HISTORY_FILE, 'utf8');
            history = text.trim() ? JSON.parse(text) : [];
        } catch (err) {
            console.error('⚠️  Could not parse history.json, starting fresh:', err.message);
            history = [];
        }
    }
    history.push(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log(`📝 Logged: ${entry.response.toUpperCase()} for ${entry.pillName}`);
}

// ------------------------------------------------------------
// MAIN TICK — runs every 20s via setInterval.
// Handles initial reminders AND nags in one place.
// ------------------------------------------------------------
async function tick(client, myNumber, config) {
    const now = new Date();

    // "HH:MM" for the current moment (e.g. "15:38")
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;

    // ---- 1. Fire initial reminders for any pill matching the current minute ----
    for (const pill of config.pills) {
        if (pill.time !== currentTime) continue;

        // Don't double-fire within the same minute
        const last = lastFiredAt.get(pill.name);
        if (last && (now - last) < 2 * 60 * 1000) continue;

        const reminderText =
            `💊 *Pill Reminder*\n\n` +
            `It's ${pill.time} — time to take your *${pill.name}* (${pill.dosage}).\n` +
            (pill.notes ? `📝 _${pill.notes}_\n\n` : `\n`) +
            `Reply *YES* when you've taken it, or *NO* to skip.`;

        try {
            await client.sendMessage(myNumber, reminderText);
            console.log(`⏰ [${now.toLocaleTimeString()}] Sent reminder for ${pill.name}`);
            pendingReminders.set(pill.name, { sentAt: new Date(), remindersSent: 1 });
            lastFiredAt.set(pill.name, new Date());
        } catch (err) {
            console.error(`❌ Failed to send reminder for ${pill.name}:`, err.message);
        }
    }

    // ---- 2. Nag any pending reminders whose interval has elapsed ----
    for (const [pillName, info] of pendingReminders) {
        const minsAgo = (new Date() - info.sentAt) / 60000;
        if (minsAgo < config.reminderIntervalMinutes) continue;

        const nagText =
            `🔁 *Still waiting on you!*\n\n` +
            `Did you take your *${pillName}* yet?\n` +
            `(This is reminder #${info.remindersSent + 1})\n\n` +
            `Reply *YES* when you've taken it, or *NO* to skip.`;

        try {
            await client.sendMessage(myNumber, nagText);
            console.log(`🔁 Nag #${info.remindersSent + 1} sent for ${pillName} (${minsAgo.toFixed(1)} min since last)`);
            pendingReminders.set(pillName, {
                sentAt: new Date(),
                remindersSent: info.remindersSent + 1
            });
        } catch (err) {
            console.error(`❌ Failed to send nag for ${pillName}:`, err.message);
        }
    }
}

// ------------------------------------------------------------
// LOAD CONFIG & CREATE WHATSAPP CLIENT
// ------------------------------------------------------------
const config = loadPills();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ------------------------------------------------------------
// EVENT: QR code (first run only)
// ------------------------------------------------------------
client.on('qr', (qr) => {
    console.log('📱 Scan this QR code with WhatsApp on your phone:');
    qrcode.generate(qr, { small: true });
});

// ------------------------------------------------------------
// EVENT: Ready — login complete, start the tick loop
// ------------------------------------------------------------
client.on('ready', async () => {
    console.log('');
    console.log('✅ WhatsApp is ready! The bot is now connected.');
    console.log('   Press Ctrl+C to stop the bot.');

    const myNumber = process.env.MY_WHATSAPP_NUMBER;
    if (!myNumber) {
        console.error('❌ MY_WHATSAPP_NUMBER is not set in .env');
        return;
    }

    // Startup message listing loaded pills
    const pillList = config.pills
        .map(p => `  • ${p.time} — ${p.name} (${p.dosage})`)
        .join('\n');
    const message =
        `👋 Pill reminder bot is online!\n\n` +
        `Loaded ${config.pills.length} pill(s):\n${pillList}\n\n` +
        `I'll remind you every ${config.reminderIntervalMinutes} min ` +
        `until you reply YES.`;

    try {
        await client.sendMessage(myNumber, message);
        console.log('📤 Sent startup message');
    } catch (err) {
        console.error('❌ Failed to send startup message:', err.message);
    }

    // Log schedule
    config.pills.forEach(p => {
        console.log(`📅 Will remind for "${p.name}" daily at ${p.time}`);
    });
    console.log(`🔁 Tick loop running every 20s (nag interval: ${config.reminderIntervalMinutes} min)`);

    // Start the unified tick loop — handles initial reminders AND nags.
    // Runs every 20 seconds; the function decides when to actually send.
    setInterval(() => tick(client, myNumber, config), 20 * 1000);
});

// ------------------------------------------------------------
// EVENT: incoming message — handle YES / NO replies
// ------------------------------------------------------------
client.on('message_create', async (msg) => {
    const myNumber = process.env.MY_WHATSAPP_NUMBER;

    // Only react to messages YOU send (your own replies in self-chat)
    if (!msg.fromMe) return;

    const text = msg.body.trim().toLowerCase();

    // Decide whether this is a YES, NO, or something else
    let reply;
    if (['yes', 'y', 'si', 'sí', '✅', '👍'].includes(text)) {
        reply = 'yes';
    } else if (['no', 'n', '❌', '👎'].includes(text)) {
        reply = 'no';
    } else {
        return;  // not a YES/NO — ignore
    }

    console.log(`💬 Got reply "${msg.body}" → interpreted as ${reply.toUpperCase()}`);

    // If nothing pending, just tell the user
    if (pendingReminders.size === 0) {
        await client.sendMessage(myNumber, `🤔 No pill reminders are waiting for a reply right now.`);
        return;
    }

    // Find the most-recently-sent pending pill
    let mostRecentName = null;
    let mostRecentInfo = null;
    for (const [pillName, info] of pendingReminders) {
        if (!mostRecentInfo || info.sentAt > mostRecentInfo.sentAt) {
            mostRecentName = pillName;
            mostRecentInfo = info;
        }
    }

    // Clear from the pending list
    pendingReminders.delete(mostRecentName);
    console.log(`   ✅ Cleared "${mostRecentName}" from pending (${pendingReminders.size} remaining)`);

    // Log to history.json for long-term tracking
    logResponse({
        timestamp: new Date().toISOString(),
        pillName: mostRecentName,
        response: reply,
        remindersSent: mostRecentInfo.remindersSent,
        originalReminderAt: mostRecentInfo.sentAt.toISOString()
    });

    // Acknowledge to the user
    if (reply === 'yes') {
        await client.sendMessage(myNumber,
            `🎉 Great! Logged that you took your *${mostRecentName}*. Stay healthy! 💪`);
    } else {
        await client.sendMessage(myNumber,
            `👍 Noted — you skipped *${mostRecentName}*. I won't keep reminding you.`);
    }
});

// ------------------------------------------------------------
// EVENT: Auth failure
// ------------------------------------------------------------
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

// ------------------------------------------------------------
// EVENT: Disconnected
// ------------------------------------------------------------
client.on('disconnected', (reason) => {
    console.log('⚠️  Disconnected:', reason);
});

// ------------------------------------------------------------
// START THE BOT
// ------------------------------------------------------------
console.log('🚀 Starting the pill reminder bot...');
client.initialize();