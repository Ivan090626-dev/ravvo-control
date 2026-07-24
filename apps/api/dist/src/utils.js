export function duration(v) { const m = v?.match(/^(\d+)(s|m|h|d|w)$/i); if (!m)
    return null; const n = Number(m[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2].toLowerCase()]); return n > 0 && n < 31622400000 ? n : null; }
export const esc = (s) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
