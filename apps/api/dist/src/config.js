import "dotenv/config";
import { z } from "zod";
export const config = z.object({
    BOT_TOKEN: z.string().min(20),
    PORT: z.coerce.number().default(4000),
    WEB_ORIGIN: z.string().default("http://localhost:5173"),
    WEBAPP_URL: z.string().url().optional(),
    ADMIN_TELEGRAM_ID: z.string().regex(/^-?\d+$/).optional()
}).parse(process.env);
