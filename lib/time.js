export function getCurrentTimeStr(timezone) {
    const tzStr = new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC', timeZoneName: 'short' });
    const isoStr = new Date().toISOString();
    return `Local Time: ${tzStr} | UTC Time: ${isoStr}`;
}

export function isTimePassed(isoString) {
    if (!isoString) return false;
    return new Date(isoString).getTime() <= new Date().getTime();
}
