/**
 * Prato RP — Sistema Ticket
 * Usato come modulo: require('./ticket.js')(client)
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  Events,
} = require("discord.js");

const CONFIG = {
  staffRoleId: "1530126746618302564",
  ticketCategoryId: "1529986873785585706",
  logCategoryId: "1529235211035086848",
};

const TICKET_TYPES = [
  { value: "segnala_persona", label: "Segnala una persona", emoji: "⚙️", description: "Utente con comportamento tossico, cheating o violazione delle regole." },
  { value: "richiesta_unban", label: "Richiesta unban", emoji: "🔓", description: "Ritieni di essere stato bannato per errore? Spiega la tua situazione." },
  { value: "segnala_bug", label: "Segnala Bug", emoji: "🐛", description: "Problema tecnico nel server o nel gioco? Descrivi cosa è successo." },
  { value: "partnership", label: "Partnership", emoji: "🤝", description: "Rappresenti una community e vuoi collaborare con Prato RP?" },
  { value: "ceo", label: "Ceo", emoji: "👑", description: "Questione importante da portare all'attenzione della direzione." },
  { value: "altro", label: "Altro", emoji: "❓", description: "Il tuo problema non rientra nelle categorie? Apri comunque un ticket." },
];

const openTickets = new Map();

function getTicketType(value) {
  return TICKET_TYPES.find((t) => t.value === value);
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle("🔧 PRATO RP | OFFICIAL SUPPORT")
    .setDescription(
      "Seleziona la categoria più adatta al tuo problema e apri un ticket.\nIl nostro staff ti risponderà il prima possibile.\n\n" +
      TICKET_TYPES.map((t) => `${t.emoji} **| ${t.label}**\n${t.description}`).join("\n\n")
    )
    .setFooter({ text: "Prato RP • Un ticket per volta per utente" });

  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket_select")
    .setPlaceholder("Scegli una categoria…")
    .addOptions(TICKET_TYPES.map((t) => ({ label: t.label, value: t.value, emoji: t.emoji, description: t.description.slice(0, 100) })));

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

async function createTicketChannel(guild, member, ticketType) {
  const channelName = `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`;
  return await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: CONFIG.ticketCategoryId,
    topic: `Ticket di ${member.user.tag} | Tipo: ${ticketType.label}`,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: CONFIG.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages] },
    ],
  });
}

async function sendTicketWelcome(channel, member, ticketType) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${ticketType.emoji} Ticket — ${ticketType.label}`)
    .setDescription(
      `Benvenuto ${member}, il tuo ticket è stato aperto.\n\n` +
      `**Categoria:** ${ticketType.emoji} ${ticketType.label}\n**Aperto da:** ${member.user.tag}\n\n` +
      "Descrivi il tuo problema nel dettaglio. Lo staff ti risponderà il prima possibile.\n\nPer chiudere il ticket premi il pulsante qui sotto."
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Chiudi ticket").setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@&${CONFIG.staffRoleId}> — nuovo ticket da ${member}`, embeds: [embed], components: [row] });
}

async function getOrCreateLogChannel(guild) {
  const existing = guild.channels.cache.find(
    (c) => c.parentId === CONFIG.logCategoryId && c.type === ChannelType.GuildText && c.name === "ticket-logs"
  );
  if (existing) return existing;
  return await guild.channels.create({
    name: "ticket-logs",
    type: ChannelType.GuildText,
    parent: CONFIG.logCategoryId,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: CONFIG.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });
}

async function sendCloseLog(guild, ticketChannel, owner, closedBy, ticketType) {
  try {
    const logChannel = await getOrCreateLogChannel(guild);
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔒 Ticket chiuso")
      .addFields(
        { name: "Utente", value: owner ? `${owner.tag} (${owner.id})` : "Sconosciuto", inline: true },
        { name: "Chiuso da", value: `${closedBy.tag} (${closedBy.id})`, inline: true },
        { name: "Categoria", value: ticketType ? `${ticketType.emoji} ${ticketType.label}` : "N/D", inline: true },
        { name: "Canale", value: ticketChannel.name, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Nessun transcript — Privacy protetta" });
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error("[LOG] Errore:", err.message);
  }
}

async function sendCloseDM(user, ticketType) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔒 Il tuo ticket è stato chiuso")
      .setDescription(
        `Il tuo ticket **${ticketType ? ticketType.emoji + " " + ticketType.label : ""}** su **Prato RP** è stato chiuso dallo staff.\n\n` +
        "Se hai bisogno di ulteriore assistenza, apri un nuovo ticket nel server.\n\n_Per motivi di privacy non viene inviato alcun transcript._"
      )
      .setTimestamp();
    await user.send({ embeds: [embed] });
  } catch { /* DM chiusi */ }
}

// ─── ESPORTATO: riceve il client da main.js ───────────────────────────────────
module.exports = function (client) {

  // Comando !ticket-panel
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || message.content !== "!ticket-panel") return;
    const member = message.member;
    if (!member) return;
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !member.roles.cache.has(CONFIG.staffRoleId)) {
      return message.reply({ content: "❌ Non hai i permessi.", allowedMentions: { repliedUser: false } });
    }
    await sendTicketPanel(message.channel);
    await message.delete().catch(() => {});
  });

  // Interazioni (select menu + bottone chiudi)
  client.on(Events.InteractionCreate, async (interaction) => {

    // ── Select menu ──
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
      const member = interaction.member;
      const guild = interaction.guild;
      const ticketType = getTicketType(interaction.values[0]);
      await interaction.deferReply({ ephemeral: true });

      if (openTickets.has(member.id)) {
        const existing = guild.channels.cache.get(openTickets.get(member.id));
        if (existing) return interaction.editReply({ content: `❌ Hai già un ticket aperto: ${existing}. Chiudilo prima.` });
        openTickets.delete(member.id);
      }

      try {
        const channel = await createTicketChannel(guild, member, ticketType);
        openTickets.set(member.id, channel.id);
        openTickets.set(`type_${channel.id}`, interaction.values[0]);
        await sendTicketWelcome(channel, member, ticketType);
        await interaction.editReply({ content: `✅ Ticket aperto! Vai in ${channel}` });
      } catch (err) {
        console.error("[TICKET] Errore:", err.message);
        await interaction.editReply({ content: "❌ Errore durante la creazione. Contatta un amministratore." });
      }
      return;
    }

    // ── Bottone chiudi ──
    if (interaction.isButton() && interaction.customId === "ticket_close") {
      const guild = interaction.guild;
      const channel = interaction.channel;
      const closedBy = interaction.user;
      const member = interaction.member;
      const isStaff = member.roles.cache.has(CONFIG.staffRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);
      const ownerId = [...openTickets.entries()].find(([key, val]) => val === channel.id && !key.startsWith("type_"))?.[0];

      if (!isStaff && closedBy.id !== ownerId) {
        return interaction.reply({ content: "❌ Solo lo staff o chi ha aperto il ticket può chiuderlo.", ephemeral: true });
      }

      await interaction.deferReply();
      const ticketType = getTicketType(openTickets.get(`type_${channel.id}`));
      const owner = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;

      await interaction.editReply({ content: `🔒 Ticket chiuso da ${closedBy}. Il canale verrà eliminato tra **5 secondi**…` });
      await sendCloseLog(guild, channel, owner || closedBy, closedBy, ticketType);
      if (owner && owner.id !== closedBy.id) await sendCloseDM(owner, ticketType);

      if (ownerId) openTickets.delete(ownerId);
      openTickets.delete(`type_${channel.id}`);
      setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
  });

};
