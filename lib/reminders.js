import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize reminders file
if (!fs.existsSync(REMINDERS_FILE)) {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify([]));
}

let reminders = [];

export function loadReminders() {
    try {
        const data = fs.readFileSync(REMINDERS_FILE, 'utf8');
        reminders = JSON.parse(data);
    } catch (e) {
        console.error("Failed to load reminders:", e);
        reminders = [];
    }
}

export function saveReminders() {
    try {
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
    } catch (e) {
        console.error("Failed to save reminders:", e);
    }
}

export function addReminder(reminder) {
    reminders.push({
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        sent: false,
        ...reminder
    });
    saveReminders();
}

export function markReminderSent(id) {
    const r = reminders.find(x => x.id === id);
    if (r) {
        r.sent = true;
        r.sentAt = new Date().toISOString();
        saveReminders();
    }
}

export function getPendingReminders() {
    return reminders.filter(r => !r.sent);
}

export function getRemindersFor(jid) {
    return reminders.filter(r => !r.sent && r.ownerJid === jid);
}
