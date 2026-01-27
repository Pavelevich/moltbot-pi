/**
 * Moltbot Pi - Telegram Bot with DeepSeek AI
 * For Raspberry Pi Zero 2W
 *
 * Features: AI chat, bash commands, file ops, GPIO, system controls
 */

import { Bot } from 'grammy';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID; // Your Telegram user ID for admin commands

if (!TELEGRAM_TOKEN || !DEEPSEEK_KEY) {
  console.error('Missing required environment variables');
  console.log('');
  console.log('Required:');
  console.log('  TELEGRAM_BOT_TOKEN - Get from @BotFather on Telegram');
  console.log('  DEEPSEEK_API_KEY   - Get from platform.deepseek.com');
  console.log('');
  console.log('Optional:');
  console.log('  TELEGRAM_ADMIN_ID  - Your Telegram user ID for admin commands');
  process.exit(1);
}

console.log('=== Moltbot Pi ===');
console.log('Platform: Raspberry Pi');
console.log('AI: DeepSeek');
console.log('Admin:', ADMIN_ID ? `ID ${ADMIN_ID}` : 'Not set (admin commands disabled)');
console.log('');

// Initialize DeepSeek (OpenAI-compatible)
const ai = new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com/v1'
});

// Initialize Telegram bot
const bot = new Bot(TELEGRAM_TOKEN);

// Helper: Check if user is admin
function isAdmin(userId: number): boolean {
  if (!ADMIN_ID) return false;
  return userId.toString() === ADMIN_ID;
}

// Helper: Run bash command
async function runCommand(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    return stdout || stderr || 'Command executed (no output)';
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

// /start command
bot.command('start', (ctx) => {
  const isUserAdmin = isAdmin(ctx.from?.id || 0);
  ctx.reply(`🤖 Moltbot Pi - Raspberry Pi AI Bot

Send me any message to chat with AI.

📋 Commands:
/help - Show all commands
/status - System status
/temp - CPU temperature
/disk - Disk usage
/network - Network info
${isUserAdmin ? '\n🔐 Admin commands available - use /help' : ''}

Built for low-end hardware. Running on 85MB RAM.`);
});

// /help command
bot.command('help', (ctx) => {
  const isUserAdmin = isAdmin(ctx.from?.id || 0);

  let helpText = `📖 Moltbot Pi Commands

📊 System Info:
/status - Bot status & memory
/temp - CPU temperature
/disk - Disk usage
/network - Network info & IP
/uptime - System uptime

💬 AI Chat:
Just send any text message to chat with DeepSeek AI.`;

  if (isUserAdmin) {
    helpText += `

🔐 Admin Commands:
/bash <command> - Run shell command
/read <path> - Read file contents
/write <path> <content> - Write to file
/gpio <pin> <on|off> - Control GPIO pin
/reboot - Reboot the Pi
/shutdown - Shutdown the Pi
/whoami - Show your Telegram ID`;
  } else {
    helpText += `

ℹ️ Admin commands are restricted.
Your ID: ${ctx.from?.id}`;
  }

  ctx.reply(helpText);
});

// /status command
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

  ctx.reply(`📊 Moltbot Pi Status

🖥️ Raspberry Pi Zero 2W
⏱️ Bot uptime: ${hours}h ${mins}m
💾 RAM used: ${Math.round(mem.rss / 1024 / 1024)} MB
🌡️ CPU temp: ${cpuTemp}
🤖 AI: DeepSeek ✓
⚡ Status: Online`);
});

// /temp command
bot.command('temp', async (ctx) => {
  try {
    const result = await runCommand('vcgencmd measure_temp 2>/dev/null || echo "temp=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk \'{print $1/1000}\')°C"');
    ctx.reply(`🌡️ CPU Temperature: ${result.replace('temp=', '').trim()}`);
  } catch {
    ctx.reply('Unable to read temperature');
  }
});

// /disk command
bot.command('disk', async (ctx) => {
  const result = await runCommand('df -h / | tail -1 | awk \'{print "Total: "$2"\\nUsed: "$3" ("$5")\\nFree: "$4}\'');
  ctx.reply(`💾 Disk Usage\n\n${result}`);
});

// /network command
bot.command('network', async (ctx) => {
  const hostname = await runCommand('hostname');
  const ip = await runCommand('hostname -I | awk \'{print $1}\'');
  const ssid = await runCommand('iwgetid -r 2>/dev/null || echo "Not connected"');
  const signal = await runCommand('iwconfig wlan0 2>/dev/null | grep -i signal | awk \'{print $4}\' | cut -d= -f2 || echo "N/A"');

  ctx.reply(`🌐 Network Info

📛 Hostname: ${hostname.trim()}
📍 IP: ${ip.trim()}
📶 WiFi: ${ssid.trim()}
📊 Signal: ${signal.trim()}`);
});

// /uptime command
bot.command('uptime', async (ctx) => {
  const result = await runCommand('uptime -p');
  ctx.reply(`⏱️ System ${result}`);
});

// /whoami command - shows user's Telegram ID
bot.command('whoami', (ctx) => {
  ctx.reply(`👤 Your Telegram ID: ${ctx.from?.id}\n\nUse this ID as TELEGRAM_ADMIN_ID to enable admin commands.`);
});

// === ADMIN COMMANDS ===

// /bash command - run shell commands
bot.command('bash', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  const cmd = ctx.message?.text?.replace('/bash', '').trim();
  if (!cmd) {
    return ctx.reply('Usage: /bash <command>\n\nExample: /bash ls -la');
  }

  console.log(`[Admin] Running: ${cmd}`);
  await ctx.replyWithChatAction('typing');

  const result = await runCommand(cmd);
  const output = result.length > 4000 ? result.substring(0, 4000) + '\n...(truncated)' : result;

  ctx.reply(`$ ${cmd}\n\n${output}`);
});

// /read command - read file contents
bot.command('read', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  const filePath = ctx.message?.text?.replace('/read', '').trim();
  if (!filePath) {
    return ctx.reply('Usage: /read <filepath>\n\nExample: /read /etc/hostname');
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const output = content.length > 4000 ? content.substring(0, 4000) + '\n...(truncated)' : content;
    ctx.reply(`📄 ${filePath}\n\n${output}`);
  } catch (error: any) {
    ctx.reply(`Error reading file: ${error.message}`);
  }
});

// /write command - write to file
bot.command('write', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  const args = ctx.message?.text?.replace('/write', '').trim();
  const firstSpace = args?.indexOf(' ') || -1;

  if (!args || firstSpace === -1) {
    return ctx.reply('Usage: /write <filepath> <content>\n\nExample: /write /tmp/test.txt Hello World');
  }

  const filePath = args.substring(0, firstSpace);
  const content = args.substring(firstSpace + 1);

  try {
    await fs.writeFile(filePath, content);
    ctx.reply(`✅ Written to ${filePath}`);
  } catch (error: any) {
    ctx.reply(`Error writing file: ${error.message}`);
  }
});

// /gpio command - control GPIO pins
bot.command('gpio', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  const args = ctx.message?.text?.replace('/gpio', '').trim().split(' ');

  if (!args || args.length < 2) {
    return ctx.reply(`Usage: /gpio <pin> <on|off|read>

Examples:
/gpio 17 on - Turn GPIO 17 HIGH
/gpio 17 off - Turn GPIO 17 LOW
/gpio 17 read - Read GPIO 17 state

Common pins: 17, 18, 22, 23, 24, 25, 27`);
  }

  const pin = args[0];
  const action = args[1].toLowerCase();

  try {
    if (action === 'on') {
      await runCommand(`echo ${pin} > /sys/class/gpio/export 2>/dev/null; echo out > /sys/class/gpio/gpio${pin}/direction; echo 1 > /sys/class/gpio/gpio${pin}/value`);
      ctx.reply(`⚡ GPIO ${pin} → HIGH`);
    } else if (action === 'off') {
      await runCommand(`echo ${pin} > /sys/class/gpio/export 2>/dev/null; echo out > /sys/class/gpio/gpio${pin}/direction; echo 0 > /sys/class/gpio/gpio${pin}/value`);
      ctx.reply(`⚡ GPIO ${pin} → LOW`);
    } else if (action === 'read') {
      const value = await runCommand(`cat /sys/class/gpio/gpio${pin}/value 2>/dev/null || echo "Pin not exported"`);
      ctx.reply(`📖 GPIO ${pin} = ${value.trim()}`);
    } else {
      ctx.reply('Invalid action. Use: on, off, or read');
    }
  } catch (error: any) {
    ctx.reply(`GPIO error: ${error.message}`);
  }
});

// /reboot command
bot.command('reboot', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  await ctx.reply('🔄 Rebooting Pi in 5 seconds...');
  setTimeout(() => {
    exec('sudo reboot');
  }, 5000);
});

// /shutdown command
bot.command('shutdown', async (ctx) => {
  if (!isAdmin(ctx.from?.id || 0)) {
    return ctx.reply('🔒 Admin only command');
  }

  await ctx.reply('⚠️ Shutting down Pi in 5 seconds...');
  setTimeout(() => {
    exec('sudo shutdown -h now');
  }, 5000);
});

// Handle text messages - AI chat
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
  ctx.reply('📷 Got your photo, but image processing is disabled in lite mode to save memory.');
});

// Start bot
console.log('Starting Telegram bot...');
bot.start({
  onStart: () => {
    const mem = process.memoryUsage();
    console.log('');
    console.log('Bot running!');
    console.log('RAM:', Math.round(mem.rss / 1024 / 1024), 'MB');
    console.log('');
    console.log('Waiting for messages...');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping bot...');
  bot.stop();
  process.exit(0);
});
