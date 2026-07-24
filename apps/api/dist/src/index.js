import { bot, expire } from "./bot.js";
import { startApi } from "./api.js";
import { db } from "./db.js";
import { config } from "./config.js";
import { processReminders } from "./reminders.js";
const server = startApi();
await expire();
await processReminders();
const timer = setInterval(() => { expire().catch(console.error); processReminders().catch(console.error); }, 30000);
bot.start({ onStart: async (i) => { console.log(`Bot @${i.username} started`); await bot.api.setMyCommands([{ command: "help", description: "Команды Ravvo" }, { command: "rules", description: "Правила группы" }, { command: "report", description: "Пожаловаться на сообщение" }, { command: "warn", description: "Выдать предупреждение" }, { command: "unwarn", description: "Снять предупреждение" }, { command: "ban", description: "Заблокировать участника" }, { command: "mute", description: "Ограничить участника" }, { command: "unmute", description: "Снять ограничения" }, { command: "kick", description: "Исключить участника" }, { command: "announce", description: "Опубликовать объявление" }]); if (config.WEBAPP_URL) {
        await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Открыть веб-версию", web_app: { url: config.WEBAPP_URL } } });
        console.log(`Telegram Mini App button: ${config.WEBAPP_URL}`);
    }
    else
        console.log("WEBAPP_URL is empty: Telegram menu button is not configured yet"); } });
async function stop() { clearInterval(timer); bot.stop(); server.close(); await db.$disconnect(); process.exit(0); }
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
