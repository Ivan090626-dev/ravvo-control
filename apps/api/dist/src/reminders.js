import { bot } from "./bot.js";
import { db } from "./db.js";
import { esc } from "./utils.js";
let running = false;
export async function processReminders() { if (running)
    return; running = true; try {
    const due = await db.reminder.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() } }, take: 50 });
    for (const item of due)
        try {
            await bot.api.sendMessage(Number(item.groupId), `⏰ <b>Напоминание</b>\n\n${esc(item.text)}\n\n<i>Автоматическое сообщение · Ravvo</i>`, { parse_mode: "HTML" });
            const now = new Date(), next = new Date(now.getTime() + item.intervalHours * 3_600_000);
            await db.reminder.update({ where: { id: item.id }, data: { lastRunAt: now, nextRunAt: next } });
        }
        catch (e) {
            console.error(`Reminder ${item.id} failed`, e);
        }
}
finally {
    running = false;
} }
