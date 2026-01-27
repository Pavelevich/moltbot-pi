/**
 * Moltbot Pi - Telegram Bot with DeepSeek AI
 * For Raspberry Pi Zero 2W
 *
 * Features:
 * - AI chat (DeepSeek)
 * - System control (bash, gpio, reboot)
 * - File vault (encrypted storage)
 * - Reminders (scheduled messages)
 * - Tapo smart home control
 */

import { Bot, InputFile } from 'grammy';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const VAULT_PASSWORD = process.env.VAULT_PASSWORD || 'moltbot-default-key';
const TAPO_EMAIL = process.env.TAPO_EMAIL;
const TAPO_PASSWORD = process.env.TAPO_PASSWORD;

if (!TELEGRAM_TOKEN || !DEEPSEEK_KEY) {
  console.error('Missing required environment variables');
  console.log('');
  console.log('Required:');
  console.log('  TELEGRAM_BOT_TOKEN - Get from @BotFather on Telegram');
  console.log('  DEEPSEEK_API_KEY   - Get from platform.deepseek.com');
  console.log('');
  console.log('Optional:');
  console.log('  TELEGRAM_ADMIN_ID  - Your Telegram user ID for admin commands');
  console.log('  VAULT_PASSWORD     - Password for file encryption');
  console.log('  TAPO_EMAIL         - TP-Link Tapo account email');
  console.log('  TAPO_PASSWORD      - TP-Link Tapo account password');
  process.exit(1);
}

// Paths
const VAULT_DIR = path.join(process.env.HOME || '/tmp', '.moltbot-vault');
const REMINDERS_FILE = path.join(process.env.HOME || '/tmp', '.moltbot-reminders.json');
const TAPO_CLI = path.join(__dirname, '..', 'scripts', 'tapo_cli.py');

console.log('=== Moltbot Pi ===');
console.log('Platform: Raspberry Pi');
console.log('AI: DeepSeek');
console.log('Admin:', ADMIN_ID ? `ID ${ADMIN_ID}` : 'Not set');
console.log('Tapo:', TAPO_EMAIL ? 'Configured' : 'Not configured');
console.log('');

// Initialize DeepSeek
const ai = new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com/v1'
});

// Initialize bot
const bot = new Bot(TELEGRAM_TOKEN);

// Reminders storage
interface Reminder {
  id: string;
  chatId: number;
  userId: number;
  message: string;
  time: number;
  created: number;
}

let reminders: Reminder[] = [];
let reminderInterval: NodeJS.Timeout;

// ==================== HELPERS ====================

function isAdmin(userId: number): boolean {
  if (!ADMIN_ID) return false;
  return userId.toString() === ADMIN_ID;
}

async function runCommand(cmd: string, timeout = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return stdout || stderr || 'Command executed (no output)';
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// Encryption helpers
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(VAULT_PASSWORD, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encrypted: string): string {
  const [ivHex, encryptedText] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(VAULT_PASSWORD, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Ensure vault directory exists
async function ensureVaultDir(): Promise<void> {
  try {
    await fs.mkdir(VAULT_DIR, { recursive: true, mode: 0o700 });
  } catch {}
}

// Load reminders from file
async function loadReminders(): Promise<void> {
  try {
    const data = await fs.readFile(REMINDERS_FILE, 'utf-8');
    reminders = JSON.parse(data);
  } catch {
    reminders = [];
  }
}

// Save reminders to file
async function saveReminders(): Promise<void> {
  await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

// Check and send due reminders
async function checkReminders(): Promise<void> {
  const now = Date.now();
  const due = reminders.filter(r => r.time <= now);

  for (const reminder of due) {
    try {
      await bot.api.sendMessage(reminder.chatId, `⏰ Reminder:\n\n${reminder.message}`);
    } catch (e) {
      console.error('Failed to send reminder:', e);
    }
  }

  if (due.length > 0) {
    reminders = reminders.filter(r => r.time > now);
    await saveReminders();
  }
}

// Parse natural language time
function parseTime(text: string): number | null {
  const now = Date.now();
  const lower = text.toLowerCase();

  // "in X minutes/hours/days"
  const inMatch = lower.match(/in\s+(\d+)\s*(min|minute|hour|hr|day|sec|second)s?/i);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    if (unit.startsWith('sec')) return now + amount * 1000;
    if (unit.startsWith('min')) return now + amount * 60 * 1000;
    if (unit.startsWith('hour') || unit === 'hr') return now + amount * 60 * 60 * 1000;
    if (unit.startsWith('day')) return now + amount * 24 * 60 * 60 * 1000;
  }

  // "at HH:MM"
  const atMatch = lower.match(/at\s+(\d{1,2}):(\d{2})/);
  if (atMatch) {
    const hours = parseInt(atMatch[1]);
    const minutes = parseInt(atMatch[2]);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    if (date.getTime() <= now) {
      date.setDate(date.getDate() + 1); // Tomorrow
    }
    return date.getTime();
  }

  // "tomorrow at HH:MM"
  const tomorrowMatch = lower.match(/tomorrow\s+at\s+(\d{1,2}):(\d{2})/);
  if (tomorrowMatch) {
    const hours = parseInt(tomorrowMatch[1]);
    const minutes = parseInt(tomorrowMatch[2]);
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  }

  return null;
}

// ==================== COMMANDS ====================

// /start
bot.command('start', (ctx) => {
  const isUserAdmin = isAdmin(ctx.from?.id || 0);
  ctx.reply(`🤖 Moltbot Pi - Raspberry Pi AI Bot

Send me any message to chat with AI.

📋 Commands:
/help - All commands
/status - System status
/vault - File storage
/remind - Set reminders
${TAPO_EMAIL ? '/home - Smart home control' : ''}
${isUserAdmin ? '\n🔐 Admin commands available' : ''}

Built for low-end hardware. 85MB RAM.`);
});

// /help
bot.command('help', (ctx) => {
  const isUserAdmin = isAdmin(ctx.from?.id || 0);

  let helpText = `📖 Moltbot Pi Commands

📊 System:
/status - System status
/temp - CPU temperature
/disk - Disk usage
/network - Network info
/uptime - Uptime

📁 File Vault:
/vault - List stored files
/vault get <name> - Retrieve file
/vault delete <name> - Delete file
Send any file to store it

⏰ Reminders:
/remind <time> <message>
/reminders - List active
/remind cancel <id> - Cancel

Examples:
  /remind in 30 minutes check oven
  /remind at 14:00 call mom
  /remind tomorrow at 9:00 meeting`;

  if (TAPO_EMAIL) {
    helpText += `

🏠 Smart Home (Tapo):
/home - Device status
/home on <device> - Turn on
/home off <device> - Turn off
/home temp - Temperature sensors
/home devices - List all`;
  }

  if (isUserAdmin) {
    helpText += `

🔐 Admin:
/bash <cmd> - Run shell command
/read <path> - Read file
/write <path> <text> - Write file
/gpio <pin> <on|off|read>
/reboot - Reboot Pi
/shutdown - Shutdown Pi`;
  }

  ctx.reply(helpText);
});

// /status
bot.command('status', async (ctx) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  let cpuTemp = 'N/A';
  try {
    const { stdout } = await execAsync('vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null');
    if (stdout.includes('temp=')) {
      cpuTemp = stdout.replace('temp=', '').replace("'C", '°C').trim();
    } else {
      cpuTemp = (parseInt(stdout) / 1000).toFixed(1) + '°C';
    }
  } catch {}

  let vaultCount = 0;
  try {
    const files = await fs.readdir(VAULT_DIR);
    vaultCount = files.length;
  } catch {}

  ctx.reply(`📊 Moltbot Pi Status

🖥️ Raspberry Pi Zero 2W
⏱️ Uptime: ${hours}h ${mins}m
💾 RAM: ${Math.round(mem.rss / 1024 / 1024)} MB
🌡️ CPU: ${cpuTemp}
🤖 AI: DeepSeek ✓
📁 Vault: ${vaultCount} files
⏰ Reminders: ${reminders.length} active
🏠 Tapo: ${TAPO_EMAIL ? 'Connected' : 'Not configured'}`);
});

// /temp
bot.command('temp', async (ctx) => {
  const result = await runCommand('vcgencmd measure_temp 2>/dev/null || echo "temp=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk \'{print $1/1000}\')°C"');
  ctx.reply(`🌡️ CPU: ${result.replace('temp=', '').trim()}`);
});

// /disk
bot.command('disk', async (ctx) => {
  const result = await runCommand('df -h / | tail -1 | awk \'{print "Total: "$2"\\nUsed: "$3" ("$5")\\nFree: "$4}\'');
  ctx.reply(`💾 Disk Usage\n\n${result}`);
});

// /network
bot.command('network', async (ctx) => {
  const hostname = await runCommand('hostname');
  const ip = await runCommand('hostname -I | awk \'{print $1}\'');
  const ssid = await runCommand('iwgetid -r 2>/dev/null || echo "N/A"');

  ctx.reply(`🌐 Network

📛 Hostname: ${hostname.trim()}
📍 IP: ${ip.trim()}
📶 WiFi: ${ssid.trim()}`);
});

// /uptime
bot.command('uptime', async (ctx) => {
  const result = await runCommand('uptime -p');
  ctx.reply(`⏱️ System ${result}`);
});

// /whoami
bot.command('whoami', (ctx) => {
  ctx.reply(`👤 Your Telegram ID: ${ctx.from?.id}\n\nSet as TELEGRAM_ADMIN_ID for admin access.`);
});

// ==================== FILE VAULT ====================

// /vault command
bot.command('vault', async (ctx) => {
  const args = ctx.message?.text?.replace('/vault', '').trim().split(' ');
  const action = args?.[0];
  const fileName = args?.slice(1).join(' ');

  await ensureVaultDir();

  if (!action) {
    // List files
    try {
      const files = await fs.readdir(VAULT_DIR);
      if (files.length === 0) {
        return ctx.reply('📁 Vault is empty.\n\nSend me any file to store it.');
      }

      let list = '📁 Stored Files:\n\n';
      for (const file of files) {
        const stat = await fs.stat(path.join(VAULT_DIR, file));
        const size = (stat.size / 1024).toFixed(1);
        const name = file.replace('.enc', '');
        list += `• ${name} (${size} KB)\n`;
      }
      list += '\nUse /vault get <name> to retrieve';
      ctx.reply(list);
    } catch {
      ctx.reply('📁 Vault is empty.');
    }
    return;
  }

  if (action === 'get' && fileName) {
    const filePath = path.join(VAULT_DIR, fileName + '.enc');
    try {
      const encrypted = await fs.readFile(filePath, 'utf-8');
      const decrypted = Buffer.from(decrypt(encrypted), 'base64');
      await ctx.replyWithDocument(new InputFile(decrypted, fileName));
    } catch {
      ctx.reply(`File "${fileName}" not found.`);
    }
    return;
  }

  if (action === 'delete' && fileName) {
    const filePath = path.join(VAULT_DIR, fileName + '.enc');
    try {
      await fs.unlink(filePath);
      ctx.reply(`✅ Deleted "${fileName}"`);
    } catch {
      ctx.reply(`File "${fileName}" not found.`);
    }
    return;
  }

  ctx.reply('Usage:\n/vault - List files\n/vault get <name>\n/vault delete <name>');
});

// Handle file uploads
bot.on('message:document', async (ctx) => {
  await ensureVaultDir();

  const doc = ctx.message.document;
  const fileName = doc.file_name || 'unnamed';

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    const encrypted = encrypt(buffer.toString('base64'));
    await fs.writeFile(path.join(VAULT_DIR, fileName + '.enc'), encrypted);

    ctx.reply(`✅ Stored "${fileName}" in vault\n\nRetrieve with: /vault get ${fileName}`);
  } catch (error: any) {
    ctx.reply('Failed to store file: ' + error.message);
  }
});

// ==================== REMINDERS ====================

// /remind command
bot.command('remind', async (ctx) => {
  const text = ctx.message?.text?.replace('/remind', '').trim();

  if (!text) {
    return ctx.reply(`⏰ Set a Reminder

Usage: /remind <when> <message>

Examples:
  /remind in 10 minutes check laundry
  /remind in 2 hours call back
  /remind at 15:30 take medicine
  /remind tomorrow at 9:00 morning meeting

List: /reminders
Cancel: /remind cancel <id>`);
  }

  if (text.startsWith('cancel ')) {
    const id = text.replace('cancel ', '').trim();
    const index = reminders.findIndex(r => r.id === id);
    if (index >= 0) {
      reminders.splice(index, 1);
      await saveReminders();
      return ctx.reply(`✅ Reminder cancelled`);
    }
    return ctx.reply(`Reminder not found`);
  }

  const time = parseTime(text);
  if (!time) {
    return ctx.reply('Could not understand time. Try:\n• in 30 minutes\n• at 14:00\n• tomorrow at 9:00');
  }

  // Extract message (everything after time phrase)
  let message = text
    .replace(/in\s+\d+\s*(min|minute|hour|hr|day|sec|second)s?/i, '')
    .replace(/at\s+\d{1,2}:\d{2}/i, '')
    .replace(/tomorrow/i, '')
    .trim();

  if (!message) {
    message = 'Reminder!';
  }

  const reminder: Reminder = {
    id: crypto.randomBytes(4).toString('hex'),
    chatId: ctx.chat.id,
    userId: ctx.from?.id || 0,
    message,
    time,
    created: Date.now()
  };

  reminders.push(reminder);
  await saveReminders();

  const when = new Date(time).toLocaleString();
  ctx.reply(`✅ Reminder set for ${when}\n\n"${message}"\n\nID: ${reminder.id}`);
});

// /reminders - list active
bot.command('reminders', (ctx) => {
  const userReminders = reminders.filter(r => r.userId === ctx.from?.id);

  if (userReminders.length === 0) {
    return ctx.reply('No active reminders.\n\nSet one with /remind');
  }

  let list = '⏰ Your Reminders:\n\n';
  for (const r of userReminders) {
    const when = new Date(r.time).toLocaleString();
    list += `• ${r.message}\n  📅 ${when}\n  ID: ${r.id}\n\n`;
  }

  ctx.reply(list);
});

// ==================== TAPO SMART HOME ====================

// /home command
bot.command('home', async (ctx) => {
  if (!TAPO_EMAIL || !TAPO_PASSWORD) {
    return ctx.reply('🏠 Smart home not configured.\n\nSet TAPO_EMAIL and TAPO_PASSWORD in .env');
  }

  const args = ctx.message?.text?.replace('/home', '').trim().split(' ');
  const action = args?.[0];
  const device = args?.slice(1).join(' ');

  // Check if tapo_cli.py exists
  try {
    await fs.access(TAPO_CLI);
  } catch {
    return ctx.reply('Tapo CLI not found. Install from:\ngithub.com/Pavelevich/tapo-smart-home-cli');
  }

  await ctx.replyWithChatAction('typing');

  if (!action || action === 'status') {
    const result = await runCommand(`python3 ${TAPO_CLI} status`, 60000);
    return ctx.reply(`🏠 Smart Home Status\n\n${result}`);
  }

  if (action === 'devices' || action === 'list') {
    const result = await runCommand(`python3 ${TAPO_CLI} list`, 30000);
    return ctx.reply(`🏠 Devices\n\n${result}`);
  }

  if (action === 'on' && device) {
    const result = await runCommand(`python3 ${TAPO_CLI} on ${device}`, 30000);
    return ctx.reply(`💡 ${result}`);
  }

  if (action === 'off' && device) {
    const result = await runCommand(`python3 ${TAPO_CLI} off ${device}`, 30000);
    return ctx.reply(`💡 ${result}`);
  }

  if (action === 'toggle' && device) {
    const result = await runCommand(`python3 ${TAPO_CLI} toggle ${device}`, 30000);
    return ctx.reply(`💡 ${result}`);
  }

  if (action === 'temp' || action === 'temperature') {
    const result = await runCommand(`python3 ${TAPO_CLI} temp`, 30000);
    return ctx.reply(`🌡️ Temperature\n\n${result}`);
  }

  if (action === 'sensors') {
    const hub = device || 'home';
    const result = await runCommand(`python3 ${TAPO_CLI} sensors ${hub}`, 30000);
    return ctx.reply(`📡 Sensors\n\n${result}`);
  }

  ctx.reply(`🏠 Smart Home Commands

/home - Status of all devices
/home devices - List all devices
/home on <device> - Turn on
/home off <device> - Turn off
/home toggle <device> - Toggle
/home temp - Temperature sensors
/home sensors [hub] - All sensors`);
});

// ==================== ADMIN COMMANDS ====================

// /bash
bot.command('bash', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const cmd = ctx.message?.text?.replace('/bash', '').trim();
  if (!cmd) {
    return ctx.reply('Usage: /bash <command>');
  }

  console.log(`[Admin] Running: ${cmd}`);
  await ctx.replyWithChatAction('typing');

  const result = await runCommand(cmd);
  const output = result.length > 4000 ? result.substring(0, 4000) + '\n...(truncated)' : result;

  ctx.reply(`$ ${cmd}\n\n${output}`);
});

// /read
bot.command('read', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const filePath = ctx.message?.text?.replace('/read', '').trim();
  if (!filePath) {
    return ctx.reply('Usage: /read <filepath>');
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const output = content.length > 4000 ? content.substring(0, 4000) + '\n...(truncated)' : content;
    ctx.reply(`📄 ${filePath}\n\n${output}`);
  } catch (error: any) {
    ctx.reply(`Error: ${error.message}`);
  }
});

// /write
bot.command('write', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/write', '').trim();
  const firstSpace = args?.indexOf(' ') || -1;

  if (!args || firstSpace === -1) {
    return ctx.reply('Usage: /write <filepath> <content>');
  }

  const filePath = args.substring(0, firstSpace);
  const content = args.substring(firstSpace + 1);

  try {
    await fs.writeFile(filePath, content);
    ctx.reply(`✅ Written to ${filePath}`);
  } catch (error: any) {
    ctx.reply(`Error: ${error.message}`);
  }
});

// /gpio
bot.command('gpio', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/gpio', '').trim().split(' ');

  if (!args || args.length < 2) {
    return ctx.reply(`Usage: /gpio <pin> <on|off|read>

Examples:
/gpio 17 on
/gpio 17 off
/gpio 17 read`);
  }

  const pin = args[0];
  const action = args[1].toLowerCase();

  if (action === 'on') {
    await runCommand(`echo ${pin} > /sys/class/gpio/export 2>/dev/null; echo out > /sys/class/gpio/gpio${pin}/direction; echo 1 > /sys/class/gpio/gpio${pin}/value`);
    ctx.reply(`⚡ GPIO ${pin} → HIGH`);
  } else if (action === 'off') {
    await runCommand(`echo ${pin} > /sys/class/gpio/export 2>/dev/null; echo out > /sys/class/gpio/gpio${pin}/direction; echo 0 > /sys/class/gpio/gpio${pin}/value`);
    ctx.reply(`⚡ GPIO ${pin} → LOW`);
  } else if (action === 'read') {
    const value = await runCommand(`cat /sys/class/gpio/gpio${pin}/value 2>/dev/null || echo "N/A"`);
    ctx.reply(`📖 GPIO ${pin} = ${value.trim()}`);
  }
});

// /reboot
bot.command('reboot', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  await ctx.reply('🔄 Rebooting in 5 seconds...');
  setTimeout(() => exec('sudo reboot'), 5000);
});

// /shutdown
bot.command('shutdown', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  await ctx.reply('⚠️ Shutting down in 5 seconds...');
  setTimeout(() => exec('sudo shutdown -h now'), 5000);
});

// ==================== AI CHAT ====================

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userName = ctx.from?.first_name || 'User';

  console.log(`[${userName}]: ${userMessage}`);

  try {
    await ctx.replyWithChatAction('typing');

    const response = await ai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are Moltbot, a friendly assistant running on a Raspberry Pi Zero 2W. Be concise and helpful. Answer in the same language the user writes in.'
        },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1024
    });

    const reply = response.choices[0]?.message?.content || 'No response';
    console.log('[Bot]:', reply.substring(0, 50) + '...');

    await ctx.reply(reply);
  } catch (error: any) {
    console.error('Error:', error.message);
    ctx.reply('Error: ' + error.message);
  }
});

// Handle photos
bot.on('message:photo', (ctx) => {
  ctx.reply('📷 Image processing disabled in lite mode.');
});

// ==================== START BOT ====================

async function start() {
  // Ensure directories exist
  await ensureVaultDir();

  // Load reminders
  await loadReminders();

  // Start reminder checker (every 30 seconds)
  reminderInterval = setInterval(checkReminders, 30000);

  // Start bot
  console.log('Starting Telegram bot...');
  bot.start({
    onStart: () => {
      const mem = process.memoryUsage();
      console.log('');
      console.log('Bot running!');
      console.log('RAM:', Math.round(mem.rss / 1024 / 1024), 'MB');
      console.log('Vault:', VAULT_DIR);
      console.log('Reminders:', reminders.length, 'active');
      console.log('');
      console.log('Waiting for messages...');
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping bot...');
  clearInterval(reminderInterval);
  bot.stop();
  process.exit(0);
});

start();
