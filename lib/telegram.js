const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, payload) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// `replyMarkup` (optional) is a Telegram inline_keyboard object, e.g.:
// { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'appr:123' }, ...]] }
async function sendMessage(chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return call('sendMessage', payload);
}

async function editMessageText(chatId, messageId, text) {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text });
}

// Stops the little "loading" spinner on the button the admin tapped.
async function answerCallbackQuery(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

module.exports = { sendMessage, editMessageText, answerCallbackQuery };
