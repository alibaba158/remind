import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT } from './prompts.js';
import { getCurrentTimeStr } from './time.js';

let genAI = null;

export function initGemini() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in .env");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

export async function processBotMessage(message, timezone, userReminders) {
    if (!genAI) initGemini();
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const contextReminders = userReminders && userReminders.length > 0 
        ? JSON.stringify(userReminders.map(r => ({ title: r.title, text: r.reminderText, time: r.scheduledTimeISO })), null, 2)
        : "No active reminders.";

    const systemPrompt = SYSTEM_PROMPT
        .replace('{CURRENT_TIME}', getCurrentTimeStr(timezone))
        .replace('{TIMEZONE}', timezone || "UTC")
        .replace('{ACTIVE_REMINDERS}', contextReminders);
        
    const fullPrompt = `${systemPrompt}\n\nUser Message: "${message}"`;
    
    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
        });
        
        let responseText = result.response.text();
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Gemini Extraction Error:", error.message);
        return null;
    }
}
