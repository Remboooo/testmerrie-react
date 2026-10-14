
export function formatDateTime(dt: (Date|string)) {
    if (!(dt instanceof Date)) {
        dt = new Date(dt);
    }
    if (dt.toLocaleDateString() === new Date().toLocaleDateString()) {
        return dt.toLocaleTimeString();
    } else {
        return dt.toLocaleString();
    }
}

export function formatBitrate(b: number) {
    let prefix = 0;
    while (b > 1000) {
        b /= 1000;
        prefix++;
    }
    return b.toFixed(1) + ["", "k", "M", "G", "T", "P"][prefix] + "bps";
}

// "1080p60 · 6.0Mbps" — a rendition as offered in the quality dropdown.
export function formatRendition(r: {height: number, framerate?: number, bitrate?: number}) {
    const fps = r.framerate ? Math.round(r.framerate) : "";
    return `${r.height}p${fps}` + (r.bitrate ? ` · ${formatBitrate(r.bitrate)}` : "");
}
