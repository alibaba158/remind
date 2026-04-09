import { GoogleGenerativeAI } from '@google/generative-ai';
import { REMINDER_EXTRACTION_PROMPT, CONVERSATIONAL_PROMPT } from './prompts.js';
import { getCurrentTimeStr } from './time.js';

let genAI = null;

export function initGemini() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in .env");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

export async function extractReminderIntent(message, timezone) {
    if (!genAI) initGemini();
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const requestOptions = modelName.includes('preview') || modelName.includes('alpha') ? { apiVersion: 'v1alpha' } : {};
    const model = genAI.getGenerativeModel({ model: modelName }, requestOptions);
    
    // Replace placeholders
    const systemPrompt = REMINDER_EXTRACTION_PROMPT
        .replace('{CURRENT_TIME}', getCurrentTimeStr(timezone))
        .replace('{TIMEZONE}', timezone || "UTC");
        
    const fullPrompt = `${systemPrompt}\n\nUser Message: "${message}"`;
    
    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        });
        
        const responseText = result.response.text();
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Gemini Extraction Error:", error.message);
        return null;
    }
}

export async function generateChatReply(message) {
    if (!genAI) initGemini();
    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const requestOptions = modelName.includes('preview') || modelName.includes('alpha') ? { apiVersion: 'v1alpha' } : {};
    const model = genAI.getGenerativeModel({ model: modelName }, requestOptions);
    
    try {
        const result = await model.generateContent({
            contents: [
                { role: 'user', parts: [{ text: CONVERSATIONAL_PROMPT + "\n\nUser Message: " + message }] }
            ]
        });
        return result.response.text();
    } catch (error) {
        console.error("Gemini Chat Error:", error.message);
        return "Sorry, I had trouble processing that.";
    }
}
