// ticket.js - Prato RP Sistema Ticket
// Uso: require('./ticket.js')(client)

const discord = require('discord.js');
const EmbedBuilder = discord.EmbedBuilder;
const ActionRowBuilder = discord.ActionRowBuilder;
const StringSelectMenuBuilder = discord.StringSelectMenuBuilder;
const ButtonBuilder = discord.ButtonBuilder;
const ButtonStyle = discord.ButtonStyle;
const PermissionFlagsBits = discord.PermissionFlagsBits;
const ChannelType = discord.ChannelType;
const Events = discord.Events;

var CONFIG = {
  staffRoleId: '1530126746618302564',
  ticketCategoryId: '1529986873785585706',
  logCategoryId: '1529235211035086848'
};

var TICKET_TYPES = [
  { value: 'segnala_persona', label: 'Segnala una persona', emoji: null, emojiText: '[SEGNALA]', description: 'Utente con comportamento tossico, cheating o violazione delle regole.' },
  { value: 'richiesta_unban', label: 'Richiesta unban', emoji: null, emojiText: '[UNBAN]', description: 'Ritieni di essere stato bannato per errore? Spiega la tua situazione.' },
  { value: 'segnala_bug', label: 'Segnala Bug', emoji: null, emojiText: '[BUG]', description: 'Problema tecnico nel server o nel gioco? Descrivi cosa e successo.' },
  { value: 'partnership', label: 'Partnership', emoji: null, emojiText: '[PARTNER]', description: 'Rappresenti una community e vuoi collaborare con Prato RP?' },
  { value: 'ceo', label: 'Ceo', emoji: null, emojiText: '[CEO]', description: 'Questione importante da portare all attenzione della direzione.' },
  { value: 'altro', label: 'Altro', emoji: null, emojiText: '[ALTRO]', description: 'Il tuo problema non rientra nelle categorie? Apri comunque un ticket.' }
];

var openTickets = new Map();

function getTicketType(value) {
  for (var i = 0; i < TICKET_TYPES.length; i++) {
    if (TICKET_TYPES[i].value === value) return TICKET_TYPES[i];
  }
  return null;
}

async function sendTicketPanel(channel) {
  var desc = 'Seleziona la categoria piu adatta al tuo problema e apri un ticket.\n';
  desc += 'Il nostro staff ti rispondera il prima possibile.\n\n';
  for (var i = 0; i < TICKET_TYPES.length; i++) {
    var t = TICKET_TYPES[i];
    desc += t.emojiText + ' **| ' + t.label + '**\n' + t.description + '\n\n';
  }

  var embed = new EmbedBuilder()
    .setColor(0xf0a500)
    .setTitle('PRATO RP | OFFICIAL SUPPORT')
    .setDescription(desc)
    .setFooter({ text: 'Prato RP - Un ticket per volta per utente' });

  var options = TICKET_TYPES.map(function(t) {
    return { label: t.label, value: t.value, description: t.description.slice(0, 100) };
  });

  var select = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('Scegli una categoria...')
    .addOptions(options);

  var row = new ActionRowBuilder().addComponents(select);
  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicketChannel(guild, member, ticketType) {
  var name = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  var channelName = 'ticket-' + name;

  return await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: CONFIG.ticketCategoryId,
    topic: 'Ticket di ' + member.user.tag + ' | Tipo: ' + ticketType.label,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: CONFIG.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ]
  });
}

async function sendTicketWelcome(channel, member, ticketType) {
  var desc = 'Benvenuto ' + member.toString() + ', il tuo ticket e stato aperto.\n\n';
  desc += '**Categoria:** ' + ticketType.emojiText + ' ' + ticketType.label + '\n';
  desc += '**Aperto da:** ' + member.user.tag + '\n\n';
  desc += 'Descrivi il tuo problema nel dettaglio.\n';
  desc += 'Lo staff ti rispondera il prima possibile.\n\n';
  desc += 'Per chiudere il ticket premi il pulsante qui sotto.';

  var embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Ticket - ' + ticketType.label)
    .setDescription(desc)
    .setTimestamp();

  var closeBtn = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Chiudi ticket')
    .setStyle(ButtonStyle.Danger);

  var row = new ActionRowBuilder().addComponents(closeBtn);

  await channel.send({
    content: '<@&' + CONFIG.staffRoleId + '> - nuovo ticket da ' + member.toString(),
    embeds: [embed],
    components: [row]
  });
}

async function getOrCreateLogChannel(guild) {
  var existing = guild.channels.cache.find(function(c) {
    return c.parentId === CONFIG.logCategoryId &&
      c.type === ChannelType.GuildText &&
      c.name === 'ticket-logs';
  });
  if (existing) return existing;

  return await guild.channels.create({
    name: 'ticket-logs',
    type: ChannelType.GuildText,
    parent: CONFIG.logCategoryId,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: CONFIG.staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
      }
    ]
  });
}

async function sendCloseLog(guild, ticketChannel, owner, closedBy, ticketType) {
  try {
    var logChannel = await getOrCreateLogChannel(guild);
    var ownerText = owner ? owner.tag + ' (' + owner.id + ')' : 'Sconosciuto';
    var typeText = ticketType ? ticketType.emojiText + ' ' + ticketType.label : 'N/D';

    var embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Ticket chiuso')
      .addFields(
        { name: 'Utente', value: ownerText, inline: true },
        { name: 'Chiuso da', value: closedBy.tag + ' (' + closedBy.id + ')', inline: true },
        { name: 'Categoria', value: typeText, inline: true },
        { name: 'Canale', value: ticketChannel.name, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Nessun transcript - Privacy protetta' });

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[LOG] Errore:', err.message);
  }
}

async function sendCloseDM(user, ticketType) {
  try {
    var typeText = ticketType ? ticketType.emojiText + ' ' + ticketType.label : '';
    var desc = 'Il tuo ticket **' + typeText + '** su **Prato RP** e stato chiuso dallo staff.\n\n';
    desc += 'Se hai bisogno di ulteriore assistenza, apri un nuovo ticket nel server.\n\n';
    desc += 'Per motivi di privacy non viene inviato alcun transcript.';

    var embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Il tuo ticket e stato chiuso')
      .setDescription(desc)
      .setTimestamp();

    await user.send({ embeds: [embed] });
  } catch (e) {
    // DM chiusi, ignoriamo
  }
}

module.exports = function(client) {

  // Comando !ticket-panel
  client.on(Events.MessageCreate, async function(message) {
    if (message.author.bot) return;
    if (message.content !== '!ticket-panel') return;
    var member = message.member;
    if (!member) return;
    var isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
    var isStaff = member.roles.cache.has(CONFIG.staffRoleId);
    if (!isAdmin && !isStaff) {
      return message.reply({ content: 'Non hai i permessi.', allowedMentions: { repliedUser: false } });
    }
    await sendTicketPanel(message.channel);
    await message.delete().catch(function() {});
  });

  // Interazioni
  client.on(Events.InteractionCreate, async function(interaction) {

    // Select menu - apertura ticket
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
      var member = interaction.member;
      var guild = interaction.guild;
      var ticketType = getTicketType(interaction.values[0]);
      await interaction.deferReply({ ephemeral: true });

      if (openTickets.has(member.id)) {
        var existingId = openTickets.get(member.id);
        var existingChannel = guild.channels.cache.get(existingId);
        if (existingChannel) {
          return interaction.editReply({ content: 'Hai gia un ticket aperto: ' + existingChannel.toString() + '. Chiudilo prima.' });
        }
        openTickets.delete(member.id);
      }

      try {
        var channel = await createTicketChannel(guild, member, ticketType);
        openTickets.set(member.id, channel.id);
        openTickets.set('type_' + channel.id, interaction.values[0]);
        await sendTicketWelcome(channel, member, ticketType);
        await interaction.editReply({ content: 'Ticket aperto! Vai in ' + channel.toString() });
      } catch (err) {
        console.error('[TICKET] Errore:', err.message);
        await interaction.editReply({ content: 'Errore durante la creazione. Contatta un amministratore.' });
      }
      return;
    }

    // Bottone chiudi ticket
    if (interaction.isButton() && interaction.customId === 'ticket_close') {
      var guild = interaction.guild;
      var channel = interaction.channel;
      var closedBy = interaction.user;
      var member = interaction.member;
      var isStaff = member.roles.cache.has(CONFIG.staffRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);

      var ownerId = null;
      openTickets.forEach(function(val, key) {
        if (val === channel.id && key.indexOf('type_') !== 0) {
          ownerId = key;
        }
      });

      if (!isStaff && closedBy.id !== ownerId) {
        return interaction.reply({ content: 'Solo lo staff o chi ha aperto il ticket puo chiuderlo.', ephemeral: true });
      }

      await interaction.deferReply();

      var typeValue = openTickets.get('type_' + channel.id);
      var ticketType = getTicketType(typeValue);
      var owner = null;
      if (ownerId) {
        try { owner = await client.users.fetch(ownerId); } catch (e) { owner = null; }
      }

      await interaction.editReply({ content: 'Ticket chiuso da ' + closedBy.toString() + '. Il canale verra eliminato tra 5 secondi...' });

      await sendCloseLog(guild, channel, owner || closedBy, closedBy, ticketType);
      if (owner && owner.id !== closedBy.id) await sendCloseDM(owner, ticketType);

      if (ownerId) openTickets.delete(ownerId);
      openTickets.delete('type_' + channel.id);

      setTimeout(function() {
        channel.delete().catch(function() {});
      }, 5000);
    }
  });
};
