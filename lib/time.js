export function getCurrentTimeStr(timezone) {
    return new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC', timeZoneName: 'short' });
}

export function isTimePassed(isoString) {
    if (!isoString) return false;
    return new Date(isoString).getTime() <= new Date().getTime();
}
