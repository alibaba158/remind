import { getPendingReminders, markReminderSent } from './reminders.js';
import { isTimePassed } from './time.js';

export function startScheduler(sendMessageCallback) {
    // Check every 15 seconds
    setInterval(async () => {
        const pending = getPendingReminders();
        for (const reminder of pending) {
            if (reminder.scheduledTimeISO && isTimePassed(reminder.scheduledTimeISO)) {
                console.log(`[Scheduler] Reminder ${reminder.id} is due. Sending to ${reminder.ownerJid}`);
                const message = `⏰ Reminder: ${reminder.reminderText}`;
                
                try {
                    await sendMessageCallback(reminder.ownerJid, message);
                    markReminderSent(reminder.id);
                } catch (error) {
                    console.error(`Failed to send reminder ${reminder.id}:`, error);
                }
            }
        }
    }, 15000);
}
