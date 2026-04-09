import 'dotenv/config';
import { connectToWhatsApp } from './lib/whatsapp.js';
import { extractReminderIntent, generateChatReply } from './lib/gemini.js';
import { loadReminders, addReminder } from './lib/reminders.js';
import { startScheduler } from './lib/scheduler.js';

// Load reminders from disk
loadReminders();

// State for pending clarifications (in-memory)
// maps jid -> { originalMessage: "..." }
const pendingClarifications = new Map();

function normalizeJid(jid) {
    if (!jid) return "";
    return jid.replace(/:.*@/, "@");
}

async function handleMessage(msg, sock) {
    const ownerNumber = process.env.OWNER_NUMBER;
    const remoteJid = msg.key.remoteJid;
    const isFromMe = msg.key.fromMe;
    const senderJid = normalizeJid(isFromMe ? sock.user.id : msg.key.participant || msg.key.remoteJid);
    const ownerJidTarget = `${ownerNumber}@s.whatsapp.net`;
    
    // Only process owner messages
    if (senderJid !== ownerJidTarget) {
        return; 
    }

    const text = msg.message.conversation || 
                 msg.message.extendedTextMessage?.text || "";

    if (!text) return; // ignore non-text

    console.log(`[Message] From: ${senderJid} Text: ${text}`);

    // Check if we are waiting for a clarification from the owner
    let messageToProcess = text;
    let isClarification = false;
    if (pendingClarifications.has(senderJid)) {
        const pending = pendingClarifications.get(senderJid);
        messageToProcess = `Original request: "${pending.originalMessage}"\nUser Clarification: "${text}"`;
        isClarification = true;
        pendingClarifications.delete(senderJid); // Clear pending state
    }

    // Process with Gemini for reminder extraction
    const timezone = process.env.TIMEZONE || 'UTC';
    const extraction = await extractReminderIntent(messageToProcess, timezone);

    if (extraction && extraction.isReminderRequest) {
        if (extraction.needsClarification) {
            // Ask for clarification
            await sock.sendMessage(remoteJid, { 
                text: extraction.clarificationQuestion || "Could you clarify the time or details?" 
            });
            // STORE pending state
            pendingClarifications.set(senderJid, {
                originalMessage: messageToProcess
            });
        } else if (extraction.scheduledTimeISO) {
            // Valid reminder setup
            addReminder({
                ownerJid: remoteJid, // where to send it
                originalMessage: messageToProcess,
                reminderText: extraction.reminderText || extraction.title,
                scheduledTimeISO: extraction.scheduledTimeISO,
                timezone: timezone,
                sourceType: isClarification ? "clarified" : "explicit"
            });
            
            await sock.sendMessage(remoteJid, { 
                text: `✅ Reminder saved for ${new Date(extraction.scheduledTimeISO).toLocaleString('en-US', {timeZone: timezone})}:\n"${extraction.reminderText || extraction.title}"`
            });
        } else {
            // Edge case failure
            await sock.sendMessage(remoteJid, { 
                text: `I understood you wanted a reminder, but I couldn't figure out the exact time. Try again?`
            });
        }
    } else {
        // Not a reminder request, do normal chat
        const reply = await generateChatReply(text);
        if (reply) {
            await sock.sendMessage(remoteJid, { text: reply });
        }
    }
}

async function start() {
    console.log("Starting WhatsApp Reminder Bot...");
    
    if (!process.env.OWNER_NUMBER || !process.env.GEMINI_API_KEY) {
        console.error("Missing critical environment variables (OWNER_NUMBER, GEMINI_API_KEY). Check .env file.");
        process.exit(1);
    }

    const sock = await connectToWhatsApp(handleMessage);
    
    startScheduler(async (jid, text) => {
        await sock.sendMessage(jid, { text });
    });
}

start();
