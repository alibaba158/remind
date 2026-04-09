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

    // Check if we are waiting for a clarification/confirmation from the owner
    let messageToProcess = `User: "${text}"`;
    let isClarification = false;
    if (pendingClarifications.has(senderJid)) {
        const pending = pendingClarifications.get(senderJid);
        messageToProcess = `${pending.history}\nUser: "${text}"`;
        isClarification = true;
        pendingClarifications.delete(senderJid); // Clear pending state
    }

    // Process with Gemini for reminder extraction
    const timezone = process.env.TIMEZONE || 'UTC';
    console.log("[Bot] Asking Gemini to extract intent...");
    const extraction = await extractReminderIntent(messageToProcess, timezone);
    console.log("[Bot] Extraction result:", extraction);

    if (extraction && extraction.isReminderRequest) {
        // If we need clarification, or we need confirmation, OR it's simply not confirmed yet
        if (extraction.needsClarification || extraction.needsConfirmation || !extraction.isConfirmed) {
            // Ask for clarification or confirmation
            const botReply = extraction.botReply || "מתי תרצה שאזכיר לך?";
            console.log("[Bot] Sending clarification:", botReply);
            await sock.sendMessage(remoteJid, { text: botReply });
            
            // STORE pending state with the full conversation history
            pendingClarifications.set(senderJid, {
                history: `${messageToProcess}\nBot: "${botReply}"`
            });
        } else if (extraction.scheduledTimeISO && extraction.isConfirmed) {
            // Valid confirmed reminder setup
            console.log("[Bot] Saving confirmed reminder...");
            addReminder({
                ownerJid: remoteJid, // where to send it
                originalMessage: messageToProcess,
                reminderText: extraction.reminderText || extraction.title,
                scheduledTimeISO: extraction.scheduledTimeISO,
                timezone: timezone,
                sourceType: isClarification ? "clarified_and_confirmed" : "explicit"
            });
            
            const successReply = `✅ התזכורת נשמרה בהצלחה ל-${new Date(extraction.scheduledTimeISO).toLocaleString('he-IL', {timeZone: timezone})}:\n"${extraction.reminderText || extraction.title}"`;
            console.log("[Bot] Sending success message:", successReply);
            await sock.sendMessage(remoteJid, { text: successReply });
        } else {
            // Edge case failure
            console.log("[Bot] Edge case failure during confirmation.");
            await sock.sendMessage(remoteJid, { 
                text: `הבנתי שרצית תזכורת, אבל לא הצלחתי להבין מתי בדיוק. נסה שוב?`
            });
        }
    } else {
        // Not a reminder request, do normal chat
        console.log("[Bot] Not a reminder. Asking Gemini for chat reply...");
        const reply = await generateChatReply(text);
        console.log("[Bot] Chat reply:", reply);
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
