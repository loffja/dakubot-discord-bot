import { Client, GatewayIntentBits, Events } from 'discord.js';
import express from 'express';

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const FAQ_CHANNEL_ID = process.env.FAQ_CHANNEL_ID;

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
});

// Se dispara cada vez que alguien entra al servidor.
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return;

        const faqMention = FAQ_CHANNEL_ID ? `<#${FAQ_CHANNEL_ID}>` : '#faq';

        await channel.send({
            content: `🌸 ¡Bienvenido/a ${member}!`,
            embeds: [
                {
                    description:
                        'Rastreador de archimonstruos en tiempo real para Dofus Touch, con cobertura del **100%** de la misión del Ocre.\n\n' +
                        '🌐 https://www.bnotifier.es\n\n' +
                        `Revisa ${faqMention} para ver cómo funciona todo, precios y cómo empezar.`,
                    color: 16723335,
                    footer: { text: 'DakuBot · Dofus Touch Archimonster Tracker' }
                }
            ]
        });
    } catch (error) {
        console.error('Error dando la bienvenida:', error);
    }
});

client.on(Events.Error, (error) => {
    console.error('Error del cliente de Discord:', error);
});

client.login(process.env.DISCORD_BOT_TOKEN);

// Servidor mínimo, solo para que Render lo trate como "Web Service" y no
// mate el proceso. También sirve para que un ping externo (CronAlert, etc.)
// lo mantenga despierto.
const app = express();
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        bot: client.user ? client.user.tag : 'conectando…'
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Healthcheck escuchando en el puerto ${PORT}`);
});
