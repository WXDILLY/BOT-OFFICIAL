// register.js - Registra i comandi slash su Discord
// Esegui UNA VOLTA SOLA cambiando il STARTUP_FILE in register.js
// Dopo che vedi "Comandi registrati!" rimetti STARTUP_FILE su main.js

var discord = require('discord.js');
var REST = discord.REST;
var Routes = discord.Routes;
var SlashCommandBuilder = discord.SlashCommandBuilder;

require('dotenv').config();

var commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Assegna ruoli a un utente')
    .addStringOption(function(o) {
      return o
        .setName('tipo')
        .setDescription('Tipo di ruolo da assegnare')
        .setRequired(true)
        .addChoices(
          { name: 'Patente', value: 'patente' },
          { name: 'Licenza', value: 'licenza' },
          { name: 'Cittadinanza', value: 'cittadinanza' },
          { name: 'Porto', value: 'porto' },
          { name: 'Tutti', value: 'tutti' }
        );
    })
    .addUserOption(function(o) {
      return o
        .setName('utente')
        .setDescription('Utente a cui assegnare il ruolo')
        .setRequired(true);
    }),

  new SlashCommandBuilder()
    .setName('revoca')
    .setDescription('Revoca i ruoli a un utente')
    .addUserOption(function(o) {
      return o
        .setName('utente')
        .setDescription('Utente a cui revocare il ruolo')
        .setRequired(true);
    })

].map(function(cmd) { return cmd.toJSON(); });

var rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands }
)
.then(function() {
  console.log('Comandi slash registrati con successo!');
  console.log('Ora rimetti STARTUP_FILE su main.js e riavvia il bot.');
  process.exit(0);
})
.catch(function(err) {
  console.error('Errore durante la registrazione:', err.message);
  process.exit(1);
});
