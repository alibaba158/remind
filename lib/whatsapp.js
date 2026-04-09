import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';

let sock = null;

export async function connectToWhatsApp(messageHandler) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to', lastDisconnect.error?.message || lastDisconnect.error, ', reconnecting', shouldReconnect);
            // Reconnect if not logged out
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(messageHandler), 3000);
            } else {
                console.log('Logged out. Please delete auth_info_baileys folder and restart to login again.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connection opened!')
        }

        // Output pairing code instead of QR if needed
        if (update.qr) {
            console.log("QR Code received. Please scan or wait for Pairing Code (if PHONE_NUMBER is set).");
        }

        /* 
         WARNING: isNewLogin check is not reliably available in all Baileys versions.
         We will just request pairing code if not currently paired 
         but typically for pairing code to work, we need to wait for a connection event like 'connection.update'.
         Baileys allows requesting pairing code when connection is starting.
        */
        if (sock.authState?.creds?.me === undefined && (update.qr || update.isNewLogin)) {
             const phoneNumber = process.env.PHONE_NUMBER;
             if (phoneNumber && !sock.authState.creds.me) {
                 setTimeout(async () => {
                     try {
                         const code = await sock.requestPairingCode(phoneNumber);
                         console.log(`\n======================================\nPAIRING CODE: ${code}\n======================================\n`);
                     } catch (err) {
                         console.error('Failed to request pairing code:', err);
                     }
                 }, 3000);
             } else if (!phoneNumber) {
                 console.log("No PHONE_NUMBER set in .env. Showing QR Code is disabled, please set PHONE_NUMBER.");
             }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message) return;
        
        // Ignore status broadcasts
        if (msg.key.remoteJid === 'status@broadcast') return;
        
        await messageHandler(msg, sock);
    });

    return sock;
}
