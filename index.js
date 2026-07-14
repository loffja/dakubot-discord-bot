import { Client, GatewayIntentBits, Events } from 'discord.js';
import express from 'express';

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const FAQ_CHANNEL_ID = process.env.FAQ_CHANNEL_ID;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const MEMBERCOUNT_CHANNEL_ID = process.env.MEMBERCOUNT_CHANNEL_ID;
const ACTIVE_CHANNEL_ID = process.env.ACTIVE_CHANNEL_ID;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const GUILD_ID = process.env.GUILD_ID;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET;

const STATS_INTERVAL_MS = 5 * 60 * 1000; // respaldo, por si algún aviso instantáneo falla

if (!process.env.DISCORD_BOT_TOKEN || !WELCOME_CHANNEL_ID) {
    console.error('Faltan DISCORD_BOT_TOKEN o WELCOME_CHANNEL_ID. El bot no puede arrancar sin ellos.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.once(Events.ClientReady, (c) => {
    console.log(`Conectado como ${c.user.tag}`);
    startStatsLoop();
});

// Se dispara cada vez que alguien entra al servidor.
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
        if (channel && channel.isTextBased()) {
            const faqMention = FAQ_CHANNEL_ID ? `<#${FAQ_CHANNEL_ID}>` : '#faq';
            await channel.send({
                embeds: [
                    {
                        description:
                            `# 🌸 ¡Bienvenido/a ${member}!\n\n` +
                            'Rastreador de archimonstruos en tiempo real para Dofus Touch, con cobertura del **100%** de la misión del Ocre.\n\n' +
                            '🌐 https://www.bnotifier.es\n\n' +
                            `Revisa 📖 ${faqMention} para ver cómo funciona todo, precios y cómo empezar.`,
                        color: 16723335,
                        image: { url: 'https://www.bnotifier.es/og-image.PNG' },
                        footer: { text: 'DakuBot · Dofus Touch Archimonster Tracker' }
                    }
                ]
            });
        }
    } catch (error) {
        console.error('Error dando la bienvenida:', error);
    }
    // Al instante, no esperamos a los 5 minutos.
    debouncedUpdateMembers();
});

// Al instante también cuando alguien se va.
client.on(Events.GuildMemberRemove, () => {
    debouncedUpdateMembers();
});

client.on(Events.Error, (error) => {
    console.error('Error del cliente de Discord:', error);
});

// --- Actualización de canales de estadísticas ---------------------------
// Guarda el último nombre puesto en cada canal para NO renombrar si no
// cambió nada — así nos mantenemos muy por debajo del límite de Discord
// (2 renombres cada 10 min por canal) en vez de rozarlo constantemente.
const lastNames = {};

// Agrupa avisos que llegan muy seguidos (por ejemplo, varias licencias
// creadas/borradas en pocos segundos durante una prueba) en una sola
// actualización real, con el dato más reciente — en vez de disparar una
// consulta y un renombrado por cada aviso individual, que puede agotar
// el límite de renombrados de Discord (2 cada 10 min por canal) sin
// necesidad.
const DEBOUNCE_MS = 3000;
const debounceTimers = {};

function debounced(key, fn) {
    return () => {
        if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(() => {
            delete debounceTimers[key];
            fn();
        }, DEBOUNCE_MS);
    };
}

// Si ya hay una petición de renombrado en curso/en cola para un canal,
// las siguientes llamadas NO disparan otra petición aparte (eso es lo que
// generaba renombrados con datos viejos, atascados en la cola de Discord).
// Solo actualizan cuál es el valor MÁS RECIENTE deseado; cuando la
// petición en curso termine, se revisa si el valor deseado cambió
// mientras tanto y, si es así, se manda una última actualización con el
// dato de verdad más reciente — nunca con uno atrasado.
const pendingRename = {};
const desiredName = {};

async function renameIfChanged(channelId, newName) {
    if (!channelId) return;
    desiredName[channelId] = newName;

    if (pendingRename[channelId]) {
        return; // ya hay alguien encargándose de este canal
    }

    pendingRename[channelId] = (async () => {
        try {
            for (;;) {
                const target = desiredName[channelId];
                const channel = await client.channels.fetch(channelId, { force: true });
                if (!channel) {
                    console.log(`[renameIfChanged] No se encontró el canal ${channelId}`);
                    break;
                }
                if (channel.name === target) {
                    lastNames[channelId] = target;
                    console.log(`[renameIfChanged] Sin cambios para ${channelId} (ya es "${target}" de verdad en Discord)`);
                } else {
                    await channel.setName(target);
                    lastNames[channelId] = target;
                    console.log(`Canal ${channelId} renombrado a: ${target}`);
                }
                // Si mientras hacíamos esto llegó un valor más nuevo, lo aplicamos también.
                if (desiredName[channelId] === target) break;
            }
        } catch (error) {
            console.error(`Error renombrando canal ${channelId}:`, error.message);
        } finally {
            delete pendingRename[channelId];
        }
    })();

    await pendingRename[channelId];
}

async function updateStatusChannel() {
    if (!STATUS_CHANNEL_ID || !ADMIN_API_KEY) return;
    try {
        const res = await fetch('https://api.bnotifier.es/admin/settings', {
            headers: { 'x-admin-key': ADMIN_API_KEY }
        });
        const data = await res.json();
        const name = data.validateEnabled ? '🟢 Status: Online' : '🔴 Status: Offline';
        await renameIfChanged(STATUS_CHANNEL_ID, name);
    } catch (error) {
        console.error('Error consultando /admin/settings:', error.message);
    }
}

async function updateMemberCountChannel() {
    if (!MEMBERCOUNT_CHANNEL_ID || !GUILD_ID) return;
    try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}?with_counts=true`, {
            headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
        });
        const data = await res.json();
        const name = `👥 Members: ${data.approximate_member_count ?? 0}`;
        await renameIfChanged(MEMBERCOUNT_CHANNEL_ID, name);
    } catch (error) {
        console.error('Error consultando miembros del servidor:', error.message);
    }
}

async function updateActiveLicensesChannel() {
    if (!ACTIVE_CHANNEL_ID) {
        console.log('[updateActiveLicensesChannel] Omitido: falta ACTIVE_CHANNEL_ID.');
        return;
    }
    try {
        const res = await fetch('https://api.bnotifier.es/stats');
        const data = await res.json();
        console.log(`[updateActiveLicensesChannel] /stats devolvió licenciasActivas = ${data.licenciasActivas}`);
        const name = `🔑 Licenses: ${data.licenciasActivas ?? 0}`;
        await renameIfChanged(ACTIVE_CHANNEL_ID, name);
    } catch (error) {
        console.error('Error consultando /stats:', error.message);
    }
}

const debouncedUpdateStatus = debounced('status', updateStatusChannel);
const debouncedUpdateMembers = debounced('members', updateMemberCountChannel);
const debouncedUpdateActive = debounced('active', updateActiveLicensesChannel);

function startStatsLoop() {
    async function tick() {
        await updateStatusChannel();
        await updateMemberCountChannel();
        await updateActiveLicensesChannel();
    }
    tick(); // primera ejecución inmediata al arrancar
    setInterval(tick, STATS_INTERVAL_MS);
}

client.login(process.env.DISCORD_BOT_TOKEN);

// --- Servidor HTTP: healthcheck + aviso instantáneo desde el backend ----
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        bot: client.user ? client.user.tag : 'conectando…'
    });
});

// Tu API llama a esto cada vez que cambia algo relevante (el interruptor
// de emergencia, o una licencia creada/extendida/borrada), para que el
// canal correspondiente se actualice al instante en vez de esperar hasta
// 5 minutos al siguiente chequeo periódico.
app.post('/notify', async (req, res) => {
    if (!NOTIFY_SECRET || req.headers['x-notify-secret'] !== NOTIFY_SECRET) {
        console.log('[/notify] Rechazado: clave incorrecta o ausente.');
        return res.status(401).json({ message: 'No autorizado.' });
    }

    const { type } = req.body || {};
    console.log(`[/notify] Aviso recibido, type = "${type}"`);
    res.status(200).json({ received: true });

    // Responder rápido y actualizar después, agrupando avisos que lleguen
    // muy seguidos en una sola actualización real (ver "debounced" arriba).
    if (type === 'settings' || !type) debouncedUpdateStatus();
    if (type === 'licencias' || !type) debouncedUpdateActive();
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Healthcheck escuchando en el puerto ${PORT}`);
});
