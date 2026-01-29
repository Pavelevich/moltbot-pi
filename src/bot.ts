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
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const TAPO_CLI = path.join(__dirname, 'scripts', 'tapo_cli.py');
const SECURITY_CLI = path.join(__dirname, 'scripts', 'security_tools.py');

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
  const userName = ctx.from?.first_name || 'Human';

  ctx.reply(`⚡ MOLTBOT PI ⚡
━━━━━━━━━━━━━━━━━━━━━

Welcome, ${userName}!

I'm your AI-powered Raspberry Pi assistant with cybersecurity superpowers.

🧠 AI Chat - Ask me anything
🔍 Network Scanner - Find devices & ports
🍯 Honeypot - Catch intruders
🔐 Password Checker - Breach detection
🏠 Smart Home - Control your devices
📁 Encrypted Vault - Secure file storage
⏰ Reminders - Never forget

${isUserAdmin ? '🛡️ ADMIN MODE ACTIVE' : ''}
${TAPO_EMAIL ? '🏠 Smart Home: Connected' : ''}

Type anything to chat, or /help for commands.

🤖 Powered by DeepSeek AI
⚡ Running on Raspberry Pi Zero 2W`);
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
/shutdown - Shutdown Pi

🛡️ Security Tools:
/security - All security commands
/scan - Network scanner
/honeypot - Intrusion detection
/wifi - WiFi security audit
/breach - Credential leak checker
/2fa - TOTP authenticator
/dns - Pi-hole control
/vpn - WireGuard VPN`;
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

// ==================== SECURITY TOOLS ====================

// /scan - Network scanner
bot.command('scan', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/scan', '').trim().split(' ');
  const action = args?.[0];

  await ctx.replyWithChatAction('typing');

  if (action === 'ports' && args?.[1]) {
    const target = args[1];
    const ports = args[2] || 'common';
    const result = await runCommand(`python3 ${SECURITY_CLI} scan ports ${target} ${ports}`, 60000);
    return ctx.reply(`🔍 Port Scan\n\n${result}`);
  }

  const result = await runCommand(`python3 ${SECURITY_CLI} scan`, 60000);
  ctx.reply(`🔍 Network Scan\n\n${result}\n\nCommands:\n/scan - Scan network\n/scan ports <ip> - Scan ports`);
});

// /alerts - Check for unknown devices
bot.command('alerts', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  await ctx.replyWithChatAction('typing');
  const result = await runCommand(`python3 ${SECURITY_CLI} alerts`, 30000);
  ctx.reply(`🚨 Security Alerts\n\n${result}`);
});

// /honeypot - Honeypot control
bot.command('honeypot', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/honeypot', '').trim().split(' ');
  const action = args?.[0];
  const service = args?.[1];

  await ctx.replyWithChatAction('typing');

  if (action === 'start' && service) {
    const result = await runCommand(`python3 ${SECURITY_CLI} honeypot start ${service}`, 30000);
    return ctx.reply(`🍯 ${result}`);
  }

  if (action === 'stop' && service) {
    const result = await runCommand(`python3 ${SECURITY_CLI} honeypot stop ${service}`, 30000);
    return ctx.reply(`🍯 ${result}`);
  }

  if (action === 'logs') {
    const limit = service || '20';
    const result = await runCommand(`python3 ${SECURITY_CLI} honeypot logs ${limit}`, 30000);
    return ctx.reply(`🍯 Honeypot Logs\n\n${result}`);
  }

  if (action === 'clear') {
    const result = await runCommand(`python3 ${SECURITY_CLI} honeypot clear`, 30000);
    return ctx.reply(`🍯 ${result}`);
  }

  const result = await runCommand(`python3 ${SECURITY_CLI} honeypot status`, 30000);
  ctx.reply(`🍯 Honeypot Status\n\n${result}\n\nCommands:\n/honeypot - Status\n/honeypot start <ssh|ftp|http|telnet>\n/honeypot stop <service>\n/honeypot logs [n]\n/honeypot clear`);
});

// /wifi - WiFi security audit
bot.command('wifi', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/wifi', '').trim().split(' ');
  const action = args?.[0] || 'audit';

  await ctx.replyWithChatAction('typing');

  if (action === 'scan') {
    const result = await runCommand(`python3 ${SECURITY_CLI} wifi scan`, 30000);
    return ctx.reply(`📡 WiFi Networks\n\n${result}`);
  }

  if (action === 'clients') {
    const result = await runCommand(`python3 ${SECURITY_CLI} wifi clients`, 30000);
    return ctx.reply(`📡 Network Clients\n\n${result}`);
  }

  const result = await runCommand(`python3 ${SECURITY_CLI} wifi audit`, 30000);
  ctx.reply(`📡 WiFi Security Audit\n\n${result}\n\nCommands:\n/wifi - Security audit\n/wifi scan - Nearby networks\n/wifi clients - Connected devices`);
});

// /breach - Breach checker
bot.command('breach', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/breach', '').trim().split(' ');
  const action = args?.[0];
  const value = args?.slice(1).join(' ');

  await ctx.replyWithChatAction('typing');

  if (action === 'email' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} breach email "${value}"`, 30000);
    return ctx.reply(`🔓 Breach Check\n\n${result}`);
  }

  if (action === 'password' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} breach password "${value}"`, 30000);
    return ctx.reply(`🔑 Password Check\n\n${result}`);
  }

  if (action === 'monitor' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} breach monitor "${value}"`, 30000);
    return ctx.reply(`📧 ${result}`);
  }

  if (action === 'list') {
    const result = await runCommand(`python3 ${SECURITY_CLI} breach list`, 30000);
    return ctx.reply(`📧 Monitored Emails\n\n${result}`);
  }

  ctx.reply(`🔓 Breach Checker

Commands:
/breach email <email> - Check email breaches
/breach password <pass> - Check if password leaked
/breach monitor <email> - Add to monitoring
/breach list - List monitored emails`);
});

// /2fa - TOTP Authenticator
bot.command('2fa', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/2fa', '').trim().split(' ');
  const action = args?.[0];
  const name = args?.[1];
  const secret = args?.slice(2).join(' ');

  await ctx.replyWithChatAction('typing');

  if (action === 'add' && name && secret) {
    const result = await runCommand(`python3 ${SECURITY_CLI} 2fa add "${name}" "${secret}"`, 30000);
    return ctx.reply(`🔐 ${result}`);
  }

  if (action === 'get' && name) {
    const result = await runCommand(`python3 ${SECURITY_CLI} 2fa get "${name}"`, 30000);
    return ctx.reply(`🔐 ${result}`);
  }

  if (action === 'remove' && name) {
    const result = await runCommand(`python3 ${SECURITY_CLI} 2fa remove "${name}"`, 30000);
    return ctx.reply(`🔐 ${result}`);
  }

  if (action === 'list') {
    const result = await runCommand(`python3 ${SECURITY_CLI} 2fa list`, 30000);
    return ctx.reply(`🔐 2FA Services\n\n${result}`);
  }

  ctx.reply(`🔐 2FA Authenticator

Commands:
/2fa add <name> <secret> - Add TOTP secret
/2fa get <name> - Get current code
/2fa remove <name> - Remove secret
/2fa list - List all services`);
});

// /dns - Pi-hole control
bot.command('dns', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/dns', '').trim().split(' ');
  const action = args?.[0] || 'status';
  const value = args?.[1];

  await ctx.replyWithChatAction('typing');

  if (action === 'enable') {
    const result = await runCommand(`python3 ${SECURITY_CLI} dns enable`, 30000);
    return ctx.reply(`🛡️ ${result}`);
  }

  if (action === 'disable') {
    const duration = value || '300';
    const result = await runCommand(`python3 ${SECURITY_CLI} dns disable ${duration}`, 30000);
    return ctx.reply(`🛡️ ${result}`);
  }

  if (action === 'block' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} dns block "${value}"`, 30000);
    return ctx.reply(`🚫 ${result}`);
  }

  if (action === 'unblock' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} dns unblock "${value}"`, 30000);
    return ctx.reply(`✅ ${result}`);
  }

  if (action === 'whitelist' && value) {
    const result = await runCommand(`python3 ${SECURITY_CLI} dns whitelist "${value}"`, 30000);
    return ctx.reply(`✅ ${result}`);
  }

  const result = await runCommand(`python3 ${SECURITY_CLI} dns status`, 30000);
  ctx.reply(`🛡️ DNS/Pi-hole\n\n${result}\n\nCommands:\n/dns - Status\n/dns enable\n/dns disable [seconds]\n/dns block <domain>\n/dns unblock <domain>\n/dns whitelist <domain>`);
});

// /vpn - WireGuard control
bot.command('vpn', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  const args = ctx.message?.text?.replace('/vpn', '').trim().split(' ');
  const action = args?.[0] || 'status';
  const value = args?.[1];

  await ctx.replyWithChatAction('typing');

  if (action === 'up') {
    const iface = value || 'wg0';
    const result = await runCommand(`python3 ${SECURITY_CLI} vpn up ${iface}`, 30000);
    return ctx.reply(`🔒 ${result}`);
  }

  if (action === 'down') {
    const iface = value || 'wg0';
    const result = await runCommand(`python3 ${SECURITY_CLI} vpn down ${iface}`, 30000);
    return ctx.reply(`🔓 ${result}`);
  }

  if (action === 'newpeer' && args?.[2] && args?.[3]) {
    const result = await runCommand(`python3 ${SECURITY_CLI} vpn newpeer "${value}" "${args[2]}" "${args[3]}"`, 30000);
    return ctx.reply(`🔑 ${result}`);
  }

  const result = await runCommand(`python3 ${SECURITY_CLI} vpn status`, 30000);
  ctx.reply(`🔒 VPN (WireGuard)\n\n${result}\n\nCommands:\n/vpn - Status\n/vpn up [interface]\n/vpn down [interface]\n/vpn newpeer <name> <server_pubkey> <endpoint>`);
});

// /security - Security overview
bot.command('security', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only');
  }

  ctx.reply(`🛡️ Security Tools

NETWORK:
/scan - Scan network for devices
/scan ports <ip> - Port scan
/alerts - Check for unknown devices

DEFENSE:
/honeypot - Intrusion detection honeypot
/wifi - WiFi security audit
/dns - Pi-hole DNS control
/vpn - WireGuard VPN

CREDENTIALS:
/breach - Check for leaked credentials
/2fa - TOTP 2FA authenticator

All commands require admin access.`);
});

// ==================== AI CHAT WITH TOOLS ====================

// Available tools for the AI
const AI_TOOLS = {
  scan_network: { cmd: `python3 ${SECURITY_CLI} scan`, desc: 'Scan network for devices' },
  scan_ports: { cmd: (ip: string) => `python3 ${SECURITY_CLI} scan ports ${ip}`, desc: 'Scan ports on IP' },
  check_password: { cmd: (pass: string) => `python3 ${SECURITY_CLI} breach password "${pass}"`, desc: 'Check if password was leaked' },
  check_email: { cmd: (email: string) => `python3 ${SECURITY_CLI} breach email "${email}"`, desc: 'Check email for breaches' },
  wifi_audit: { cmd: `python3 ${SECURITY_CLI} wifi audit`, desc: 'Audit WiFi security' },
  wifi_scan: { cmd: `python3 ${SECURITY_CLI} wifi scan`, desc: 'Scan nearby WiFi networks' },
  honeypot_status: { cmd: `python3 ${SECURITY_CLI} honeypot status`, desc: 'Show honeypot status' },
  honeypot_start: { cmd: (svc: string) => `python3 ${SECURITY_CLI} honeypot start ${svc}`, desc: 'Start honeypot service' },
  honeypot_logs: { cmd: `python3 ${SECURITY_CLI} honeypot logs 20`, desc: 'Show honeypot logs' },
  totp_get: { cmd: (name: string) => `python3 ${SECURITY_CLI} 2fa get "${name}"`, desc: 'Get 2FA code' },
  totp_list: { cmd: `python3 ${SECURITY_CLI} 2fa list`, desc: 'List 2FA services' },
  system_status: { cmd: 'echo "CPU: $(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk \'{print $1/1000}\'°C || echo N/A)" && free -m | grep Mem | awk \'{print "RAM: "$3"/"$2" MB"}\'', desc: 'System status' },
  home_status: { cmd: `python3 ${TAPO_CLI} status`, desc: 'Smart home status' },
  home_on: { cmd: (device: string) => `python3 ${TAPO_CLI} on ${device}`, desc: 'Turn on device' },
  home_off: { cmd: (device: string) => `python3 ${TAPO_CLI} off ${device}`, desc: 'Turn off device' },
  home_temp: { cmd: `python3 ${TAPO_CLI} temp`, desc: 'Temperature sensors' },
  alerts: { cmd: `python3 ${SECURITY_CLI} alerts`, desc: 'Check for unknown devices' },
};

const SYSTEM_PROMPT = `You are Moltbot, an AI assistant running on a Raspberry Pi Zero 2W with security and smart home capabilities.

You can execute tools by responding with a JSON block. When the user asks you to do something that requires a tool, respond with:
\`\`\`json
{"tool": "tool_name", "args": "optional_argument"}
\`\`\`

Available tools:
- scan_network: Scan the local network for devices
- scan_ports: Scan ports on an IP (args: IP address)
- check_password: Check if a password was leaked in breaches (args: password)
- check_email: Check if email appears in breaches (args: email)
- wifi_audit: Audit current WiFi security
- wifi_scan: Scan for nearby WiFi networks
- honeypot_status: Show honeypot intrusion detection status
- honeypot_start: Start a honeypot service (args: ssh, ftp, http, or telnet)
- honeypot_logs: Show recent intrusion attempts
- totp_get: Get current 2FA code (args: service name)
- totp_list: List configured 2FA services
- system_status: Show CPU temp and RAM usage
- home_status: Show smart home device status
- home_on: Turn on a smart device (args: device name)
- home_off: Turn off a smart device (args: device name)
- home_temp: Show temperature sensors
- alerts: Check for unknown/suspicious devices on network

Examples:
- User: "scan my network" → {"tool": "scan_network"}
- User: "is password123 safe?" → {"tool": "check_password", "args": "password123"}
- User: "turn on the plug" → {"tool": "home_on", "args": "enchufe"}
- User: "check ports on 192.168.2.1" → {"tool": "scan_ports", "args": "192.168.2.1"}

If the user just wants to chat or asks something that doesn't need a tool, respond normally without JSON.
Be concise. Answer in the same language the user writes in.`;

async function executeAITool(toolName: string, args?: string): Promise<string | null> {
  const tool = AI_TOOLS[toolName as keyof typeof AI_TOOLS];
  if (!tool) return null;

  let cmd: string;
  if (typeof tool.cmd === 'function') {
    if (!args) return `Error: ${toolName} requires an argument`;
    cmd = tool.cmd(args);
  } else {
    cmd = tool.cmd;
  }

  console.log(`[AI Tool] Executing: ${toolName}${args ? ` (${args})` : ''}`);
  return await runCommand(cmd, 60000);
}

bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userName = ctx.from?.first_name || 'User';
  const userId = ctx.from?.id || 0;
  const userIsAdmin = isAdmin(userId);

  console.log(`[${userName}]: ${userMessage}`);

  try {
    await ctx.replyWithChatAction('typing');

    const response = await ai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1024
    });

    let reply = response.choices[0]?.message?.content || 'No response';
    console.log('[Bot]:', reply.substring(0, 100) + '...');

    // Check if AI wants to execute a tool
    const jsonMatch = reply.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const toolRequest = JSON.parse(jsonMatch[1]);
        const toolName = toolRequest.tool;
        const toolArgs = toolRequest.args;

        // Security check - only admins can execute tools
        if (!userIsAdmin) {
          await ctx.reply('🔒 Tool execution requires admin access. Use /whoami to get your ID.');
          return;
        }

        // Execute the tool
        const toolResult = await executeAITool(toolName, toolArgs);

        if (toolResult) {
          // Get AI to summarize the result
          const summaryResponse = await ai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: 'Summarize this tool output concisely for the user. Keep the important data. Answer in the same language as the original request.' },
              { role: 'user', content: `Original request: "${userMessage}"\n\nTool output:\n${toolResult}` }
            ],
            max_tokens: 1024
          });

          reply = summaryResponse.choices[0]?.message?.content || toolResult;
        } else {
          reply = `Unknown tool: ${toolName}`;
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        // If JSON parsing fails, just send the original reply
        reply = reply.replace(/```json[\s\S]*?```/, '').trim() || reply;
      }
    }

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
