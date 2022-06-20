
export function formatDateTime(dt) {
    if (!(dt instanceof Date)) {
        dt = new Date(dt);
    }
    if (dt.toLocaleDateString() === new Date().toLocaleDateString()) {
        return dt.toLocaleTimeString();
    } else {
        return dt.toLocaleString();
    }
}

export function formatBitrate(b) {
    let prefix = 0;
    while (b > 1000) {
        b /= 1000;
        prefix++;
    }
    return b.toFixed(1) + ["", "k", "M", "G", "T", "P"][prefix] + "bps";
}
