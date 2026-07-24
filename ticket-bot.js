/**
 * Prato RP — Sistema Ticket
 * Discord.js v14
 *
 * Installa le dipendenze:
 *   npm install discord.js dotenv
 *
 * Crea un file .env con:
 *   TOKEN=il_tuo_token_del_bot
 *
 * Avvia con:
 *   node ticket-bot.js
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  Events,
} = require("discord.js");

require("dotenv").config();

// ─── CONFIGURAZIONE ───────────────────────────────────────────────────────────
const CONFIG = {
  token: process.env.TOKEN,

  // Ruolo staff (può vedere e gestire i ticket)
  staffRoleId: "1530126746618302564",

  // Categoria dove vengono aperti i ticket
  ticketCategoryId: "1529986873785585706",

  // Categoria dove vengono inviati i log di chiusura
  logCategoryId: "1529235211035086848",
};

// ─── CATEGORIE TICKET ─────────────────────────────────────────────────────────
const TICKET_TYPES = [
  {
    value: "segnala_persona",
    label: "Segnala una persona",
    emoji: "⚙️",
    description:
      "Utente con comportamento tossico, cheating o violazione delle regole.",
  },
  {
    value: "richiesta_unban",
    label: "Richiesta unban",
    emoji: "🔓",
    description: "Ritieni di essere stato bannato per errore? Spiega la tua situazione.",
  },
  {
    value: "segnala_bug",
    label: "Segnala Bug",
    emoji: "🐛",
    description: "Problema tecnico nel server o nel gioco? Descrivi cosa è successo.",
  },
  {
    value: "partnership",
    label: "Partnership",
    emoji: "🤝",
    description: "Rappresenti una community e vuoi collaborare con Prato RP?",
  },
  {
    value: "ceo",
    label: "Ceo",
    emoji: "👑",
    description: "Questione importante da portare all'attenzione della direzione.",
  },
  {
    value: "altro",
    label: "Altro",
    emoji: "❓",
    description: "Il tuo problema non rientra nelle categorie? Apri comunque un ticket.",
  },
];

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Tiene traccia dei ticket aperti: { userId: channelId }
const openTickets = new Map();

// ─── UTILITY ──────────────────────────────────────────────────────────────────
function getTicketType(value) {
  return TICKET_TYPES.find((t) => t.value === value);
}

/** Invia il pannello ticket in un canale */
async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle("🔧 PRATO RP | OFFICIAL SUPPORT")
    .setDescription(
      "Seleziona la categoria più adatta al tuo problema e apri un ticket.\n" +
        "Il nostro staff ti risponderà il prima possibile.\n\n" +
        TICKET_TYPES.map(
          (t) => `${t.emoji} **| ${t.label}**\n${t.description}`
        ).join("\n\n")
    )
    .setFooter({ text: "Prato RP • Un ticket per volta per utente" });

  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket_select")
    .setPlaceholder("Scegli una categoria…")
    .addOptions(
      TICKET_TYPES.map((t) => ({
        label: t.label,
        value: t.value,
        emoji: t.emoji,
        description: t.description.slice(0, 100),
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await channel.send({ embeds: [embed], components: [row] });
}

/** Crea il canale ticket per l'utente */
async function createTicketChannel(guild, member, ticketType) {
  const category = guild.channels.cache.get(CONFIG.ticketCategoryId);
  if (!category) throw new Error("Categoria ticket non trovata.");

  const channelName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: CONFIG.ticketCategoryId,
    topic: `Ticket di ${member.user.tag} | Tipo: ${ticketType.label}`,
    permissionOverwrites: [
      // Nega @everyone
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      // Permetti all'utente
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      // Permetti allo staff
      {
        id: CONFIG.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
  });

  return channel;
}

/** Invia il messaggio di benvenuto nel canale ticket */
async function sendTicketWelcome(channel, member, ticketType) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${ticketType.emoji} Ticket — ${ticketType.label}`)
    .setDescription(
      `Benvenuto ${member}, il tuo ticket è stato aperto.\n\n` +
        `**Categoria:** ${ticketType.emoji} ${ticketType.label}\n` +
        `**Aperto da:** ${member.user.tag}\n\n` +
        "Descrivi il tuo problema nel dettaglio. Lo staff ti risponderà il prima possibile.\n\n" +
        "Per chiudere il ticket premi il pulsante qui sotto."
    )
    .setTimestamp();

  const closeBtn = new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("🔒 Chiudi ticket")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(closeBtn);

  await channel.send({
    content: `<@&${CONFIG.staffRoleId}> — nuovo ticket aperto da ${member}`,
    embeds: [embed],
    components: [row],
  });
}

/** Invia il log di chiusura nel canale di log */
async function sendCloseLog(guild, ticketChannel, user, closedBy, ticketType) {
  const logCategory = guild.channels.cache.get(CONFIG.logCategoryId);
  if (!logCategory) return;

  // Trova o crea un canale log testuale nella categoria log
  let logChannel = guild.channels.cache.find(
    (c) =>
      c.parentId === CONFIG.logCategoryId &&
      c.type === ChannelType.GuildText &&
      c.name === "ticket-logs"
  );

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: "ticket-logs",
      type: ChannelType.GuildText,
      parent: CONFIG.logCategoryId,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: CONFIG.staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🔒 Ticket chiuso")
    .addFields(
      { name: "Utente", value: `${user.tag} (${user.id})`, inline: true },
      { name: "Chiuso da", value: `${closedBy.tag} (${closedBy.id})`, inline: true },
      { name: "Categoria", value: ticketType ? `${ticketType.emoji} ${ticketType.label}` : "N/D", inline: true },
      { name: "Canale", value: ticketChannel.name, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: "Nessun transcript inviato per privacy" });

  await logChannel.send({ embeds: [embed] });
}

/** Invia DM all'utente alla chiusura (senza transcript) */
async function sendCloseDM(user, ticketType) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔒 Il tuo ticket è stato chiuso")
      .setDescription(
        `Il tuo ticket **${ticketType ? ticketType.emoji + " " + ticketType.label : ""}** su **Prato RP** è stato chiuso dallo staff.\n\n` +
          "Se hai bisogno di ulteriore assistenza, puoi aprire un nuovo ticket nel server.\n\n" +
          "_Per motivi di privacy non viene inviato alcun transcript della conversazione._"
      )
      .setTimestamp();

    await user.send({ embeds: [embed] });
  } catch {
    // L'utente potrebbe avere i DM chiusi; ignoriamo l'errore
  }
}

// ─── EVENTO READY ─────────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
  console.log("Usa !ticket-panel in un canale per pubblicare il pannello ticket.");
});

// ─── COMANDO !ticket-panel ────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content !== "!ticket-panel") return;

  const member = message.member;
  if (!member) return;

  // Solo staff o amministratori possono pubblicare il pannello
  if (
    !member.roles.cache.has(CONFIG.staffRoleId) &&
    !member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return message.reply("❌ Non hai i permessi per fare questo.");
  }

  await sendTicketPanel(message.channel);
  await message.delete().catch(() => {});
});

// ─── SELEZIONE CATEGORIA TICKET ───────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  // ── Select menu ──
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
    const member = interaction.member;
    const guild = interaction.guild;
    const selectedValue = interaction.values[0];
    const ticketType = getTicketType(selectedValue);

    await interaction.deferReply({ ephemeral: true });

    // Controlla ticket già aperto
    if (openTickets.has(member.id)) {
      const existingChannel = guild.channels.cache.get(openTickets.get(member.id));
      if (existingChannel) {
        return interaction.editReply({
          content: `❌ Hai già un ticket aperto: ${existingChannel}. Chiudilo prima di aprirne uno nuovo.`,
        });
      }
      // Il canale non esiste più; rimuovi il riferimento stale
      openTickets.delete(member.id);
    }

    try {
      const channel = await createTicketChannel(guild, member, ticketType);
      openTickets.set(member.id, channel.id);
      // Salva l'id del tipo nella mappa per recuperarlo alla chiusura
      openTickets.set(`type_${channel.id}`, selectedValue);

      await sendTicketWelcome(channel, member, ticketType);

      await interaction.editReply({
        content: `✅ Ticket aperto! Vai in ${channel}`,
      });
    } catch (err) {
      console.error(err);
      await interaction.editReply({
        content: "❌ Errore durante la creazione del ticket. Contatta un amministratore.",
      });
    }
    return;
  }

  // ── Bottone chiudi ──
  if (interaction.isButton() && interaction.customId === "ticket_close") {
    const guild = interaction.guild;
    const channel = interaction.channel;
    const closedBy = interaction.user;

    // Solo staff o il proprietario del ticket possono chiudere
    const member = interaction.member;
    const isStaff =
      member.roles.cache.has(CONFIG.staffRoleId) ||
      member.permissions.has(PermissionFlagsBits.Administrator);

    // Trova l'utente proprietario del ticket
    const ownerId = [...openTickets.entries()].find(
      ([key, val]) => val === channel.id && !key.startsWith("type_")
    )?.[0];

    if (!isStaff && closedBy.id !== ownerId) {
      return interaction.reply({
        content: "❌ Solo lo staff o chi ha aperto il ticket può chiuderlo.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const typeValue = openTickets.get(`type_${channel.id}`);
    const ticketType = getTicketType(typeValue);
    const owner = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;

    // Aggiorna messaggio con avviso di chiusura
    await interaction.editReply({
      content: `🔒 Ticket chiuso da ${closedBy}. Il canale verrà eliminato tra 5 secondi…`,
    });

    // Log
    await sendCloseLog(guild, channel, owner || closedBy, closedBy, ticketType);

    // DM all'utente (senza transcript)
    if (owner) await sendCloseDM(owner, ticketType);

    // Pulizia mappa
    if (ownerId) openTickets.delete(ownerId);
    openTickets.delete(`type_${channel.id}`);

    // Elimina canale dopo 5 secondi
    setTimeout(() => {
      channel.delete().catch(() => {});
    }, 5000);
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(CONFIG.token);
