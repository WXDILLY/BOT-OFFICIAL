// main.js - entrypoint del bot
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { Pool } = require('pg');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages] });

// ID canali e ruoli: puoi configurare tramite .env
const CANALE_RICHIESTA_ID = process.env.CANALE_RICHIESTA_ID || "1530235036367061104";
const CANALE_LOG_ID = process.env.CANALE_LOG_ID || "1530235257016680448";
const RUOLO_RICHIESTA_ID = process.env.RUOLO_RICHIESTA_ID || "1523264734697099385"; // Ruolo richiesto per aprire conto
const RUOLO_APPROVATO_ID = process.env.RUOLO_APPROVATO_ID || "1530306848863968469"; // Ruolo dato quando conto approvato
const RUOLO_STAFF_BANCA = "1523257608310489230"; // Ruolo richiesto per accettare/rifiutare richieste

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Mappa per tracciare le richieste di conto in sospeso
const richiestePendenti = new Map();

function formatEuro(amount) {
  return new Intl.NumberFormat('it-IT').format(amount);
}

client.once('ready', async () => {
  console.log(`Banca Toscana online come ${client.user.tag}!`);

  try {
    // Creazione tabelle se non esistono
    await pool.query(`
      CREATE TABLE IF NOT EXISTS banca_toscana (
        user_id VARCHAR(50) PRIMARY KEY,
        saldo BIGINT NOT NULL DEFAULT 5000,
        nome_cognome VARCHAR(255),
        nome_roblox VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active'
      );
    `);

    // Aggiungi la colonna status se non esiste
    await pool.query(`
      ALTER TABLE banca_toscana 
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
    `);

    // Aggiungi le colonne nome_cognome e nome_roblox se non esistono
    await pool.query(`
      ALTER TABLE banca_toscana 
      ADD COLUMN IF NOT EXISTS nome_cognome VARCHAR(255);
    `);

    await pool.query(`
      ALTER TABLE banca_toscana 
      ADD COLUMN IF NOT EXISTS nome_roblox VARCHAR(255);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS controllo_tasse (
        id VARCHAR(50) PRIMARY KEY,
        ultimo_prelievo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transazioni (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        mittente VARCHAR(50),
        destinatario VARCHAR(50),
        importo BIGINT NOT NULL,
        causale TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Tabelle database verificate con successo.');

    const capitaleTesoreria = parseInt(process.env.CAPITALE_INIZIALE_TESORERIA, 10) || 100000000;
    await pool.query(`
      INSERT INTO banca_toscana (user_id, saldo, status)
      VALUES ('TESORERIA_PRATO', $1, 'active')
      ON CONFLICT (user_id) DO NOTHING;
    `, [capitaleTesoreria]);

    // Avvia il ciclo di controllo fiscale ogni ora (verifica se sono passati 7 giorni)
    setInterval(gestisciTassazioneSettimanale, 1000 * 60 * 60);
    // Esegui subito una prima verifica
    gestisciTassazioneSettimanale();

  } catch (err) {
    console.error('Errore inizializzazione database:', err);
  }
});

// Funzione automatica per il prelievo fiscale del 12% ogni 7 giorni
async function gestisciTassazioneSettimanale() {
  const clientDb = await pool.connect();
  try {
    const resTimer = await clientDb.query("SELECT ultimo_prelievo FROM controllo_tasse WHERE id = 'FISCO_TOSCANA'");
    let deveTassare = false;

    if (resTimer.rows.length === 0) {
      deveTassare = true;
      await clientDb.query("INSERT INTO controllo_tasse (id, ultimo_prelievo) VALUES ('FISCO_TOSCANA', CURRENT_TIMESTAMP)");
    } else {
      const ultimoPrelievo = new Date(resTimer.rows[0].ultimo_prelievo);
      const adesso = new Date();
      const differenzaGiorni = (adesso - ultimoPrelievo) / (1000 * 60 * 60 * 24);
      if (differenzaGiorni >= 7) deveTassare = true;
    }

    if (!deveTassare) {
      console.log('Nessuna tassazione necessaria in questo momento.');
      return;
    }

    console.log('Inizio elaborazione prelievo fiscale settimanale...');
    await clientDb.query('BEGIN');

    // Seleziona tutti gli utenti eccetto TESORERIA_PRATO con saldo > 0 e metti in lock
    const utenti = await clientDb.query("SELECT user_id, saldo FROM banca_toscana WHERE user_id != 'TESORERIA_PRATO' AND saldo > 0 AND status = 'active' FOR UPDATE");

    let gettitoTotale = 0;
    for (const riga of utenti.rows) {
      const saldo = parseInt(riga.saldo, 10) || 0;
      const prelievo = Math.floor(saldo * 0.12);
      if (prelievo > 0) {
        await clientDb.query("UPDATE banca_toscana SET saldo = saldo - $1 WHERE user_id = $2", [prelievo, riga.user_id]);
        gettitoTotale += prelievo;

        // registra transazione (storico)
        await clientDb.query(
          "INSERT INTO transazioni (tipo, mittente, destinatario, importo, causale) VALUES ($1,$2,$3,$4,$5)",
          ['tassa_settimanale', riga.user_id, 'TESORERIA_PRATO', prelievo, 'Tassazione settimanale 12%']
        );
      }
    }

    if (gettitoTotale > 0) {
      await clientDb.query("UPDATE banca_toscana SET saldo = saldo + $1 WHERE user_id = 'TESORERIA_PRATO'", [gettitoTotale]);
    }

    await clientDb.query("UPDATE controllo_tasse SET ultimo_prelievo = CURRENT_TIMESTAMP WHERE id = 'FISCO_TOSCANA'");
    await clientDb.query('COMMIT');

    // Invia l'annuncio nel canale LOG
    try {
      const canaleLog = await client.channels.fetch(CANALE_LOG_ID).catch(() => null);
      if (canaleLog) {
        const embedTasse = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('🏛️ | Ministero delle Finanze - Tesoreria di Prato')
          .setDescription(
            `⚠️ **AVVISO FISCALE AUTOMATICO** ⚠️\n\n` +
            `Si comunica alla cittadinanza che i sistemi centrali di **Banca Toscana** hanno eseguito il prelievo automatizzato della **Tassazione Settimanale** ordinaria.\n\n` +
            `📊 **| Dettagli Operazione:**\n` +
            `• Aliquota applicata: **12%** sul saldo disponibile\n` +
            `• Totale gettito incamerato dallo Stato: € ${formatEuro(gettitoTotale)},00\n` +
            `• Destinatario fondi: **Tesoreria dello Stato (Prato)**\n\n` +
            `*Nota: I prelievi vengono eseguiti regolarmente ogni 7 giorni come previsto dalla legge sul bilancio pubblico.*`
          )
          .setTimestamp()
          .setFooter({ text: 'Tesoreria dello Stato • Repubblica RP' });

        await canaleLog.send({ embeds: [embedTasse] });
      }
    } catch (e) {
      console.error('Errore invio log tasse:', e);
    }

    console.log(`Tassazione completata. Riscossi € ${formatEuro(gettitoTotale)}`);
  } catch (err) {
    try { await clientDb.query('ROLLBACK'); } catch (_) {}
    console.error('Errore nel ciclo fiscale:', err);
  } finally {
    clientDb.release();
  }
}

client.on('interactionCreate', async (interaction) => {
  // Pulsante: apri conto (mostra modal)
  if (interaction.isButton() && interaction.customId === 'apri_conto_toscana') {
    // Verifica se l'utente ha GIÀ il ruolo approvato (conto già aperto)
    const ruoloApprovato = interaction.member.roles.cache.get(RUOLO_APPROVATO_ID);
    if (ruoloApprovato) {
      return interaction.reply({
        content: `❌ Hai già aperto un conto corrente in Banca Toscana! Non puoi aprirne un altro.`,
        ephemeral: true
      });
    }

    // Verifica se l'utente ha il ruolo richiesto per fare richiesta
    const ruolo = interaction.member.roles.cache.get(RUOLO_RICHIESTA_ID);
    if (!ruolo) {
      return interaction.reply({
        content: `❌ Devi avere il ruolo <@&${RUOLO_RICHIESTA_ID}> per aprire un conto corrente.`,
        ephemeral: true
      });
    }

    // Crea il modal per la compilazione
    const modal = new ModalBuilder()
      .setCustomId('form_apertura_conto')
      .setTitle('📋 Modulo Apertura Conto Corrente');

    const nomeCognomeInput = new TextInputBuilder()
      .setCustomId('nome_cognome')
      .setLabel('Nome e Cognome (RP)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Es: Mario Rossi')
      .setRequired(true);

    const nomeRobloxInput = new TextInputBuilder()
      .setCustomId('nome_roblox')
      .setLabel('Nome Roblox')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Es: MarioRossi123')
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(nomeCognomeInput);
    const secondActionRow = new ActionRowBuilder().addComponents(nomeRobloxInput);

    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
  }

  // Gestione del modal di apertura conto
  if (interaction.isModalSubmit() && interaction.customId === 'form_apertura_conto') {
    await interaction.deferReply({ ephemeral: true });

    const nomeCognome = interaction.fields.getTextInputValue('nome_cognome');
    const nomeRoblox = interaction.fields.getTextInputValue('nome_roblox');
    const userId = interaction.user.id;

    try {
      // Salva i dati in memoria
      richiestePendenti.set(userId, {
        nomeCognome,
        nomeRoblox,
        userId,
        username: interaction.user.username,
        userTag: interaction.user.tag
      });

      // Salva i dati nel database con status 'pending'
      await pool.query(
        "INSERT INTO banca_toscana (user_id, nome_cognome, nome_roblox, saldo, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO UPDATE SET nome_cognome = $2, nome_roblox = $3, status = $5",
        [userId, nomeCognome, nomeRoblox, 5000, 'pending']
      );

      // Invia il log nel canale con pulsanti di approvazione/rifiuto
      const canaleLog = await client.channels.fetch(CANALE_LOG_ID).catch(() => null);
      if (canaleLog) {
        const embedRichiesta = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('📝 | Richiesta Apertura Conto Corrente')
          .setDescription(`Una nuova richiesta di apertura conto corrente è in sospeso.`)
          .addFields(
            { name: '👤 Discord', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
            { name: '🆔 ID Utente', value: `\`${userId}\``, inline: true },
            { name: '📋 Nome e Cognome (RP)', value: nomeCognome, inline: false },
            { name: '🎮 Nome Roblox', value: nomeRoblox, inline: false }
          )
          .setTimestamp()
          .setFooter({ text: 'In attesa di approvazione' });

        const rowBottoni = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approva_conto_${userId}`)
            .setLabel('✅ Approva')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`rifiuta_conto_${userId}`)
            .setLabel('❌ Rifiuta')
            .setStyle(ButtonStyle.Danger)
        );

        const messaggio = await canaleLog.send({ embeds: [embedRichiesta], components: [rowBottoni] });
        richiestePendenti.get(userId).messaggioId = messaggio.id;
      }

      return interaction.editReply({
        content: '✅ La tua richiesta di apertura conto è stata inviata! Attendi l\'approvazione dello staff nel DM.'
      });

    } catch (err) {
      console.error('Errore durante il form apertura conto:', err);
      return interaction.editReply({
        content: '❌ Errore durante l\'invio della richiesta. Riprova più tardi.'
      });
    }
  }

  // Gestione pulsante approva conto
  if (interaction.isButton() && interaction.customId.startsWith('approva_conto_')) {
    // Controllo: solo chi ha il ruolo staff banca può approvare
    if (!interaction.member.roles.cache.has(RUOLO_STAFF_BANCA)) {
      return interaction.reply({
        content: `❌ Non hai i permessi per approvare le richieste. Serve il ruolo <@&${RUOLO_STAFF_BANCA}>.`,
        ephemeral: true
      });
    }

    const userId = interaction.customId.replace('approva_conto_', '');
    
    try {
      const datiRichiesta = richiestePendenti.get(userId);
      if (!datiRichiesta) {
        return interaction.reply({
          content: '❌ Richiesta non trovata o già processata.',
          ephemeral: true
        });
      }

      const clientDb = await pool.connect();
      try {
        await clientDb.query('BEGIN');

        // Verifica che TESORERIA_PRATO abbia fondi sufficienti
        const tesoreriaRes = await clientDb.query(
          'SELECT saldo FROM banca_toscana WHERE user_id = $1 FOR UPDATE',
          ['TESORERIA_PRATO']
        );
        const saldoTesoreria = parseInt(tesoreriaRes.rows[0]?.saldo || '0', 10);

        if (saldoTesoreria < 5000) {
          await clientDb.query('ROLLBACK');
          return interaction.reply({
            content: '❌ Errore: I fondi della Tesoreria di Prato sono esauriti.',
            ephemeral: true
          });
        }

        // Aggiorna lo status a 'active'
        await clientDb.query(
          "UPDATE banca_toscana SET saldo = $1, status = 'active' WHERE user_id = $2",
          [5000, userId]
        );

        // Sottrai fondi da TESORERIA_PRATO
        await clientDb.query(
          "UPDATE banca_toscana SET saldo = saldo - $1 WHERE user_id = $2",
          [5000, 'TESORERIA_PRATO']
        );

        // Registra la transazione
        await clientDb.query(
          "INSERT INTO transazioni (tipo, mittente, destinatario, importo, causale) VALUES ($1,$2,$3,$4,$5)",
          ['apertura_conto', 'TESORERIA_PRATO', userId, 5000, 'Accredito benvenuto apertura conto']
        );

        await clientDb.query('COMMIT');

        // Assegna il ruolo approvato
        const guild = interaction.guild;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.roles.add(RUOLO_APPROVATO_ID);
        }

        // Invia DM all'utente
        const user = await client.users.fetch(userId);
        if (user) {
          const embedBenvenuto = new EmbedBuilder()
            .setColor('#006400')
            .setTitle('🏛️ | Banca Toscana - Conto Approvato ✅')
            .setDescription(`Benvenuto in Banca Toscana, ${datiRichiesta.username}!\n\nIl tuo conto corrente è stato **APPROVATO** e è ora operativo.`)
            .addFields(
              { name: '📋 Nome e Cognome (RP)', value: datiRichiesta.nomeCognome, inline: true },
              { name: '🎮 Nome Roblox', value: datiRichiesta.nomeRoblox, inline: true },
              { name: '🎁 Accredito di Benvenuto', value: '€ 5.000,00', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Banca Toscana S.p.A. • Sicurezza e Stabilità' });

          await user.send({ embeds: [embedBenvenuto] });
        }

        // Aggiorna il messaggio nel canale log
        await interaction.message.edit({
          embeds: [
            new EmbedBuilder()
              .setColor('#006400')
              .setTitle('📝 | Richiesta Apertura Conto - APPROVATA ✅')
              .setDescription(`Conto corrente approvato da ${interaction.user.tag}`)
              .addFields(
                { name: '👤 Discord', value: `<@${userId}>`, inline: true },
                { name: '✅ Approvato da', value: interaction.user.tag, inline: true }
              )
              .setTimestamp()
          ],
          components: []
        });

        richiestePendenti.delete(userId);
        return interaction.reply({
          content: `✅ Conto corrente approvato per <@${userId}>! Ruolo assegnato e DM inviato.`,
          ephemeral: true
        });

      } catch (err) {
        await clientDb.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        clientDb.release();
      }

    } catch (err) {
      console.error('Errore durante approvazione conto:', err);
      return interaction.reply({
        content: '❌ Errore durante l\'approvazione del conto.',
        ephemeral: true
      });
    }
  }

  // Gestione pulsante rifiuta conto
  if (interaction.isButton() && interaction.customId.startsWith('rifiuta_conto_')) {
    // Controllo: solo chi ha il ruolo staff banca può rifiutare
    if (!interaction.member.roles.cache.has(RUOLO_STAFF_BANCA)) {
      return interaction.reply({
        content: `❌ Non hai i permessi per rifiutare le richieste. Serve il ruolo <@&${RUOLO_STAFF_BANCA}>.`,
        ephemeral: true
      });
    }

    const userId = interaction.customId.replace('rifiuta_conto_', '');

    try {
      const datiRichiesta = richiestePendenti.get(userId);
      if (!datiRichiesta) {
        return interaction.reply({
          content: '❌ Richiesta non trovata o già processata.',
          ephemeral: true
        });
      }

      // Elimina dal database
      await pool.query("DELETE FROM banca_toscana WHERE user_id = $1", [userId]);

      // Invia DM all'utente
      const user = await client.users.fetch(userId);
      if (user) {
        const embedRifiuto = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('🏛️ | Banca Toscana - Conto Rifiutato ❌')
          .setDescription(`Spiacenti, la tua richiesta di apertura conto è stata **RIFIUTATA**.`)
          .addFields(
            { name: '📋 Nome e Cognome (RP)', value: datiRichiesta.nomeCognome, inline: true },
            { name: '🎮 Nome Roblox', value: datiRichiesta.nomeRoblox, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: 'Banca Toscana S.p.A.' });

        await user.send({ embeds: [embedRifiuto] });
      }

      // Aggiorna il messaggio nel canale log
      await interaction.message.edit({
        embeds: [
          new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('📝 | Richiesta Apertura Conto - RIFIUTATA ❌')
            .setDescription(`Conto corrente rifiutato da ${interaction.user.tag}`)
            .addFields(
              { name: '👤 Discord', value: `<@${userId}>`, inline: true },
              { name: '❌ Rifiutato da', value: interaction.user.tag, inline: true }
            )
            .setTimestamp()
        ],
        components: []
      });

      richiestePendenti.delete(userId);
      return interaction.reply({
        content: `❌ Richiesta di conto rifiutata per <@${userId}>. Notifica inviata via DM.`,
        ephemeral: true
      });

    } catch (err) {
      console.error('Errore durante rifiuto conto:', err);
      return interaction.reply({
        content: '❌ Errore durante il rifiuto del conto.',
        ephemeral: true
      });
    }
  }

  // Solo comandi chat input (slash)
  if (!interaction.isChatInputCommand()) return;

  // Comando: invia_pannello (solo staff)
  if (interaction.commandName === 'invia_pannello') {
    // Controllo permessi: ManageGuild come esempio
    if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: '❌ Permessi insufficienti.', ephemeral: true });
    }

    const embedIniziale = new EmbedBuilder()
      .setColor('#006400')
      .setTitle('🏛️ Servizi Bancari | Apri il tuo conto corrente')
      .setDescription(
        `Benvenuto nel portale telematico di **Banca Toscana**.\n\n` +
        `Grazie a questa piattaforma digitale potrai:\n\n` +
        `• **Richiedere l'apertura** di un conto corrente registrato presso la filiale di Prato\n` +
        `• **Monitorare i tuoi risparmi** in modo sicuro, trasparente e immediato\n` +
        `• **Inviare bonifici bancari** per pagare tasse, stipendi o transazioni commerciali\n` +
        `• **Accedere in tempo reale** alle funzioni digitali di home banking sul territorio\n\n` +
        `⏳ *Il sistema elaborerà la tua richiesta ed erogherà i fondi in tempo reale.*`
      )
      .setFooter({ text: 'Banca Toscana S.p.A. • Sicurezza e stabilità per il cittadino' });

    const bottoneApri = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('apri_conto_toscana').setLabel('Apri il Conto Corrente').setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embedIniziale], components: [bottoneApri] });
    return interaction.reply({ content: 'Pannello inviato correttamente in questo canale!', ephemeral: true });
  }

  // Comando: saldo_toscana
  if (interaction.commandName === 'saldo_toscana') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await pool.query('SELECT saldo, status FROM banca_toscana WHERE user_id = $1', [interaction.user.id]);
      if (res.rows.length === 0 || res.rows[0].status !== 'active') {
        return interaction.editReply({ content: '❌ Non hai ancora un conto aperto o è in sospeso. Clicca sul pulsante nel canale di attivazione!' });
      }
      const saldoAttuale = parseInt(res.rows[0].saldo, 10) || 0;
      const embedSaldo = new EmbedBuilder()
        .setColor('#006400')
        .setTitle('🏛️ | Banca Toscana - Servizi Online')
        .setDescription(`Buon pomeriggio, ${interaction.user}!\n\n💳 **| Saldo Disponibile**\n€ ${formatEuro(saldoAttuale)},00`)
        .setTimestamp()
        .setFooter({ text: 'Banca Toscana S.p.A. • Messaggio Privato' });

      return interaction.editReply({ embeds: [embedSaldo] });
    } catch (err) {
      console.error('Errore saldo:', err);
      return interaction.editReply({ content: 'Errore durante la lettura del saldo bancario.' });
    }
  }

  // Comando: bonifico_toscana
  if (interaction.commandName === 'bonifico_toscana') {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('utente');
    const importo = interaction.options.getInteger('importo');
    const causale = interaction.options.getString('causale') || 'Bonifico Bancario';

    if (!target) return interaction.editReply({ content: '❌ Beneficiario non valido.' });
    if (!importo || importo <= 0) return interaction.editReply({ content: '❌ Importo non valido.' });
    if (target.id === interaction.user.id) return interaction.editReply({ content: '❌ Non puoi farti un bonifico da solo.' });

    const clientDb = await pool.connect();
    try {
      await clientDb.query('BEGIN');

      const mittenteRes = await clientDb.query('SELECT saldo, status FROM banca_toscana WHERE user_id = $1 FOR UPDATE', [interaction.user.id]);
      if (mittenteRes.rows.length === 0 || mittenteRes.rows[0].status !== 'active') {
        await clientDb.query('ROLLBACK');
        return interaction.editReply({ content: '❌ Non possiedi un conto aperto o attivo in Banca Toscana.' });
      }
      const saldoMittente = parseInt(mittenteRes.rows[0].saldo, 10) || 0;
      if (saldoMittente < importo) {
        await clientDb.query('ROLLBACK');
        return interaction.editReply({ content: '❌ Saldo insufficiente per completare l\'operazione.' });
      }

      const targetRes = await clientDb.query('SELECT saldo, status FROM banca_toscana WHERE user_id = $1 FOR UPDATE', [target.id]);
      if (targetRes.rows.length === 0 || targetRes.rows[0].status !== 'active') {
        await clientDb.query('ROLLBACK');
        return interaction.editReply({ content: '❌ Il beneficiario selezionato non ha un conto attivo in Banca Toscana.' });
      }

      await clientDb.query('UPDATE banca_toscana SET saldo = saldo - $1 WHERE user_id = $2', [importo, interaction.user.id]);
      await clientDb.query('UPDATE banca_toscana SET saldo = saldo + $1 WHERE user_id = $2', [importo, target.id]);

      await clientDb.query(
        "INSERT INTO transazioni (tipo, mittente, destinatario, importo, causale) VALUES ($1,$2,$3,$4,$5)",
        ['bonifico', interaction.user.id, target.id, importo, causale]
      );

      await clientDb.query('COMMIT');

      const embedBonifico = new EmbedBuilder()
        .setColor('#006400')
        .setTitle('💸 | Bonifico Eseguito | Banca Toscana')
        .setDescription('Trasferimento fondi completato con successo tramite i nostri sistemi professionali.')
        .addFields(
          { name: '👤 Beneficiario', value: `${target} (${target.tag})`, inline: true },
          { name: '💰 Importo', value: `€ ${formatEuro(importo)},00`, inline: true },
          { name: '📝 Causale', value: causale, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Operazione tracciata dai sistemi di Banca Toscana' });

      return interaction.editReply({ embeds: [embedBonifico] });
    } catch (err) {
      try { await clientDb.query('ROLLBACK'); } catch (_) {}
      console.error('Errore bonifico:', err);
      return interaction.editReply({ content: 'Errore di rete durante il trasferimento dei fondi.' });
    } finally {
      clientDb.release();
    }
  }
});

client.login(process.env.BOT_TOKEN);
