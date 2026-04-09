import 'dotenv/config';
import { connectToWhatsApp } from './lib/whatsapp.js';
import { processBotMessage } from './lib/gemini.js';
import { loadReminders, addReminder, getRemindersFor } from './lib/reminders.js';
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

let reminderGroupJid = null;

async function ensureReminderGroup(sock) {
    try {
        const ownerJidTarget = `${process.env.OWNER_NUMBER}@s.whatsapp.net`;
        const groups = await sock.groupFetchAllParticipating();
        for (const [id, group] of Object.entries(groups)) {
            if (group.subject === "התזכורות שלי") {
                reminderGroupJid = id;
                console.log("[Bot] Found existing reminders group:", id);
                return;
            }
        }
        
        console.log("[Bot] Creating new reminders group...");
        const group = await sock.groupCreate("התזכורות שלי", [ownerJidTarget]);
        reminderGroupJid = group.id;
        
        await sock.sendMessage(reminderGroupJid, { text: "שלום! הקבוצה הזו נוצרה אוטומטית כדי לרכז את כל התזכורות שלך במקום אחד. אפשר להתכתב איתי כאן! 😊" });
    } catch (e) {
        console.error("Failed to setup reminder group:", e);
    }
}

async function handleMessage(msg, sock) {
    const ownerNumber = process.env.OWNER_NUMBER;
    const remoteJid = msg.key.remoteJid;
    const isFromMe = msg.key.fromMe;
    const selfJid = normalizeJid(sock.user.id);
    const senderJid = normalizeJid(isFromMe ? sock.user.id : msg.key.participant || msg.key.remoteJid);
    const ownerJidTarget = `${ownerNumber}@s.whatsapp.net`;
    
    // Only process owner messages
    if (senderJid !== ownerJidTarget) {
        return; 
    }

    // STRICTLY ignore messages if they are not in the dedicated group or a direct message to the bot/self!
    // This prevents the bot from answering every time the owner texts their mom or types in a family group.
    if (remoteJid !== reminderGroupJid && remoteJid !== ownerJidTarget && remoteJid !== selfJid) {
        return;
    }

    const text = msg.message.conversation || 
                 msg.message.extendedTextMessage?.text || "";

    if (!text) return; // ignore non-text

    console.log(`[Message] From: ${senderJid} Text: ${text}`);

    // Check if we are waiting for a clarification/confirmation from the owner
    let messageToProcess = `User: "${text}"`;
    let isClarification = false;
    if (pendingClarifications.has(senderJid)) {
        const pending = pendingClarifications.get(senderJid);
        messageToProcess = `${pending.history}\nUser: "${text}"`;
        isClarification = true;
        pendingClarifications.delete(senderJid); // Clear pending state
    }

    // Process with Gemini for reminder extraction & chat
    const timezone = process.env.TIMEZONE || 'UTC';
    const userReminders = getRemindersFor(remoteJid);
    console.log("[Bot] Asking Gemini to process intent...");
    const aiResponse = await processBotMessage(messageToProcess, timezone, userReminders);
    console.log("[Bot] AI result:", aiResponse);

    if (!aiResponse) return; // Handle error gracefully

    let finalMessage = "";

    if (aiResponse.isReminderRequest) {
        // Handling a reminder request
        if (aiResponse.needsConfirmation || !aiResponse.isConfirmed) {
            finalMessage = aiResponse.botReply || "מתי תרצה שאזכיר לך?";
            
            pendingClarifications.set(senderJid, {
                history: `${messageToProcess}\nBot: "${finalMessage}"`
            });
        } else if (aiResponse.scheduledTimeISO && aiResponse.isConfirmed) {
            addReminder({
                ownerJid: reminderGroupJid || remoteJid, // Always prefer sending the actual scheduled reminder to the dedicated group!
                originalMessage: messageToProcess,
                reminderText: aiResponse.reminderText || aiResponse.title,
                scheduledTimeISO: aiResponse.scheduledTimeISO,
                timezone: timezone,
                sourceType: isClarification ? "clarified_and_confirmed" : "explicit"
            });
            
            finalMessage = `✅ התזכורת נשמרה בהצלחה ל-${new Date(aiResponse.scheduledTimeISO).toLocaleString('he-IL', {timeZone: timezone})}:\n"${aiResponse.reminderText || aiResponse.title}"`;
        } else {
            finalMessage = `הבנתי שרצית תזכורת, אבל לא הצלחתי להבין מתי בדיוק. נסה שוב?`;
        }
    } else {
        // Natural conversational reply (or listing tasks based on botReply)
        finalMessage = aiResponse.botReply || "לא הבנתי את כוונתך. איך אוכל לעזור?";
    }

    if (finalMessage) {
        const prefix = aiResponse.isReminderRequest ? "*🤖 יצירת תזכורת:*\n" : "*🤖 בוט התזכורות:*\n";
        const payloadText = `${prefix}${finalMessage}`;
        console.log("[Bot] Sending message:", payloadText);
        await sock.sendMessage(remoteJid, { text: payloadText });
    }
}

async function start() {
    console.log("Starting WhatsApp Reminder Bot...");
    
    if (!process.env.OWNER_NUMBER || !process.env.GEMINI_API_KEY) {
        console.error("Missing critical environment variables (OWNER_NUMBER, GEMINI_API_KEY). Check .env file.");
        process.exit(1);
    }

    const sock = await connectToWhatsApp(handleMessage);
    
    sock.ev.on('connection.update', async (update) => {
        if (update.connection === 'open') {
            await ensureReminderGroup(sock);
        }
    });
    
    startScheduler(async (jid, text) => {
        await sock.sendMessage(jid, { text: `*🤖 מזכיר לך!:*\n${text}` });
    });
}

start();
