import { db } from "./db.js";
export const defaults = { welcomeEnabled: true, welcomeText: "Добро пожаловать, {user}, в {group}! Ознакомьтесь с правилами: /rules", goodbyeEnabled: false, goodbyeText: "{user} покинул(а) сообщество.", captchaEnabled: false, captchaMinutes: 3, antiLinks: false, allowedDomains: [], antiFlood: true, floodMessages: 6, floodSeconds: 8, antiCaps: false, capsPercent: 75, badWordsEnabled: false, badWords: [], blockForwards: false, blockMedia: false, warnLimit: 3, warnAction: "mute", logActions: true, deleteServiceMessages: false };
export async function getSettings(groupId) { const g = await db.group.findUnique({ where: { id: groupId }, select: { settings: true } }); try {
    return { ...defaults, ...JSON.parse(g?.settings || "{}") };
}
catch {
    return { ...defaults };
} }
export async function saveSettings(groupId, value) { const settings = { ...defaults, ...value }; await db.group.update({ where: { id: groupId }, data: { settings: JSON.stringify(settings) } }); return settings; }
