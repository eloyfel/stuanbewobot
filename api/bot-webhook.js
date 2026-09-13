const { sendMessage } = require('../lib/telegram');
const { upsertParticipant, getBotFlow, setBotFlow } = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const update = req.body;
  const message = update && update.message;

  if (!message || !message.text) {
    res.status(200).send('ok');
    return;
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    const flow = await getBotFlow(chatId);

    if (text === '/start') {
      const a = Math.floor(Math.random() * 8) + 2;
      const b = Math.floor(Math.random() * 8) + 2;
      await setBotFlow(chatId, { step: 'awaiting_answer', answer: a + b, handle: flow && flow.handle });
      await sendMessage(
        chatId,
        `Welcome to STUAN BEWO 🤖\nLet's get you on the participant list.\n\nTo register, just solve this: what's ${a} + ${b}?`
      );
      return res.status(200).send('ok');
    }

    if (text === '/login') {
      if (flow && flow.handle) {
        const code = await upsertParticipant(flow.handle);
        await sendMessage(
          chatId,
          `New access code for @${flow.handle}: ${code}\nThe old one stopped working.`
        );
      } else {
        await setBotFlow(chatId, { step: 'awaiting_username' });
        await sendMessage(chatId, `Send me your X (Twitter) username, e.g. @yourname`);
      }
      return res.status(200).send('ok');
    }

    if (flow && flow.step === 'awaiting_answer') {
      if (parseInt(text, 10) === flow.answer) {
        await setBotFlow(chatId, { step: 'awaiting_username', handle: flow.handle });
        await sendMessage(chatId, `Correct ✅ Now send me your X (Twitter) username, e.g. @yourname`);
      } else {
        await setBotFlow(chatId, { step: 'idle', handle: flow.handle });
        await sendMessage(chatId, `Not quite — send /start to try again.`);
      }
      return res.status(200).send('ok');
    }

    if (flow && flow.step === 'awaiting_username') {
      const handle = text.replace(/^@/, '').trim();
      if (!handle) {
        await sendMessage(chatId, `That doesn't look like a username — send it like @yourname.`);
      } else {
        const code = await upsertParticipant(handle);
        await setBotFlow(chatId, { step: 'idle', handle });
        await sendMessage(
          chatId,
          `You're registered as @${handle} 🎉 You'll show up on the site's participant list.\n\nYour access code: ${code}\nThis logs you into the site — keep it like a password. Send /login anytime to get a new one (the old one stops working).`
        );
      }
      return res.status(200).send('ok');
    }

    await sendMessage(chatId, `Send /start to register or /login to get a new access code.`);
    res.status(200).send('ok');
  } catch (err) {
    console.error('bot-webhook error:', err);
    res.status(200).send('ok');
  }
};
