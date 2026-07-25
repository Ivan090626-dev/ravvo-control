import { InputFile } from "grammy";
import { join } from "node:path";
export function sticker(name) {
    return new InputFile(join(process.cwd(), "apps", "api", "assets", "stickers", `${name}.webp`));
}
export async function sendSticker(c, name) {
    try {
        await c.replyWithSticker(sticker(name));
    }
    catch {
        // Text remains available if Telegram rejects a local sticker upload.
    }
}
