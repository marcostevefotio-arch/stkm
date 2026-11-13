const normalizeBackup = value => {
    if (Buffer.isBuffer(value)) return { $binary:value.toString('base64') };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizeBackup);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,normalizeBackup(item)]));
    return value;
};
const restoreBackupValue = value => {
    if (Array.isArray(value)) return value.map(restoreBackupValue);
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === '$binary') {
            if (typeof value.$binary !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$binary)) {
                throw Object.assign(Error('Le fichier de sauvegarde contient une pièce binaire invalide.'), { status:400 });
            }
            return Buffer.from(value.$binary,'base64');
        }
        return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,restoreBackupValue(item)]));
    }
    return value;
};
const canonicalValue = value => {
    if (Buffer.isBuffer(value)) return `binary:${value.toString('base64')}`;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && /^[\[{]/.test(value)) {
        try { return JSON.stringify(JSON.parse(value)); } catch {}
    }
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value;
};
const sameBackupRow = (left,right,columns) => columns.every(column => canonicalValue(left[column]) === canonicalValue(right[column]));
module.exports = { normalizeBackup,restoreBackupValue,sameBackupRow };
