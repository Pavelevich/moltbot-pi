/**
 * Moltbot Lite - Telegram Bot with DeepSeek AI
 * For Raspberry Pi Zero 2W
 */

import { Bot } from 'grammy';
import OpenAI from 'openai';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

if (!TELEGRAM_TOKEN || !DEEPSEEK_KEY) {
  console.error('❌ Error: Missing required environment variables');
  console.log('');
  console.log('Required:');
  console.log('  TELEGRAM_BOT_TOKEN - Get from @BotFather on Telegram');
  console.log('  DEEPSEEK_API_KEY   - Get from platform.deepseek.com');
  console.log('');
  console.log('Usage:');
  console.log('  export TELEGRAM_BOT_TOKEN=your_telegram_token');
  console.log('  export DEEPSEEK_API_KEY=your_deepseek_key');
  console.log('  node --experimental-strip-types bot.ts');
  process.exit(1);
}

console.log('=== Moltbot Lite ===');
console.log('Platform: Raspberry Pi');
console.log('AI: DeepSeek');
console.log('');

// Initialize DeepSeek (OpenAI-compatible)
const ai = new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com/v1'
});

// Initialize Telegram bot
const bot = new Bot(TELEGRAM_TOKEN);

// /start command
bot.command('start', (ctx) => {
  ctx.reply('🤖 Moltbot Lite en Raspberry Pi!\n\nEnvíame un mensaje y te responderé con DeepSeek AI.\n\nComandos:\n/status - Ver estado del bot');
});

// /status command
bot.command('status', async (ctx) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const mins = Math.floor(uptime / 60);
  const secs = Math.floor(uptime % 60);
  
  ctx.reply(`📊 Estado de Moltbot Lite

🖥️ Raspberry Pi Zero 2W
⏱️ Uptime: ${mins}m ${secs}s
💾 RAM: ${Math.round(mem.rss / 1024 / 1024)} MB
🤖 AI: DeepSeek ✓`);
});

// Handle text messages
bot.on('message:text', async (ctx) => {
  const userMessage = ctx.message.text;
  const userName = ctx.from?.first_name || 'Usuario';
  
  console.log(`[${userName}]: ${userMessage}`);
  
  try {
    await ctx.replyWithChatAction('typing');
    
    const response = await ai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { 
          role: 'system', 
          content: 'Eres Moltbot, un asistente amigable corriendo en una Raspberry Pi. Responde de forma concisa y útil.' 
        },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 1024
    });
    
    const reply = response.choices[0]?.message?.content || 'Sin respuesta';
    console.log('[Bot]:', reply.substring(0, 50) + '...');
    
    await ctx.reply(reply);
  } catch (error: any) {
    console.error('Error:', error.message);
    ctx.reply('❌ Error: ' + error.message);
  }
});

// Handle photos
bot.on('message:photo', (ctx) => {
  ctx.reply('📷 Recibí tu foto, pero el procesamiento de imágenes está deshabilitado en modo lite.');
});

// Start bot
console.log('Iniciando bot de Telegram...');
bot.start({
  onStart: () => {
    const mem = process.memoryUsage();
    console.log('');
    console.log('✅ Bot corriendo!');
    console.log('RAM:', Math.round(mem.rss / 1024 / 1024), 'MB');
    console.log('');
    console.log('Esperando mensajes...');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nDeteniendo bot...');
  bot.stop();
  process.exit(0);
});
