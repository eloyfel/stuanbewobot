const { sendMessage, editMessageText, answerCallbackQuery } = require('../lib/telegram');
const {
  upsertParticipant,
  getBotFlow,
  setBotFlow,
  addSubmission,
  listPendingSubmissions,
  getSubmission,
  setSubmissionStatus,
} = require('../lib/store');

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // your Telegram chat id, set as an env var

function isAdmin(chatId) {
  return ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID);
}

// Escapes the handful of characters legacy Telegram Markdown treats as
// special, so a handle like "some_user" or "a*b" can't break formatting
// or swallow the rest of the message.
function escapeMarkdown(text) {
  return String(text).replace(/([_*`[])/g, '\\$1');
}

function formatSubmission(sub) {
  return `New entry from @${sub.handle}\n${sub.url}\nSubmitted ${sub.submittedAt.toISOString()}`;
}

function approvalKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `appr:${id}` },
        { text: '❌ Reject', callback_data: `rej:${id}` },
      ],
    ],
  };
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();

  const flow = await getBotFlow(chatId);

  if (text === '/start') {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    await setBotFlow(chatId, { step: 'awaiting_answer', answer: a + b, handle: flow && flow.handle });
    await sendMessage(
      chatId,
      `Welcome to STUAN BEWO 🤖\nLet's get you on the participant list.\n\nTo register, just solve this: what's ${a} + ${b}?`
    );
    return;
  }

  if (text === '/login') {
    if (flow && flow.handle) {
      const code = await upsertParticipant(flow.handle);
      await sendMessage(
        chatId,
        `New access code for @${escapeMarkdown(flow.handle)}:\n\`${code}\`\nTap it to copy. The old one stopped working.`,
        null,
        'Markdown'
      );
    } else {
      await setBotFlow(chatId, { step: 'awaiting_username' });
      await sendMessage(chatId, `Send me your X (Twitter) username, e.g. @yourname`);
    }
    return;
  }

  if (text === '/submit') {
    if (!flow || !flow.handle) {
      await sendMessage(chatId, `Register first with /start — then come back and send /submit.`);
      return;
    }
    await setBotFlow(chatId, { step: 'awaiting_submission_url', handle: flow.handle });
    await sendMessage(
      chatId,
      `Send the link to your X post or comment about the partner — one strength, one flaw, tagged with #StuanBewo and #partnerusername.\n\nIt'll go under review before it counts as an entry.`
    );
    return;
  }

  // Admin-only: list submissions waiting for review, one at a time with buttons.
  if (text === '/pending') {
    if (!isAdmin(chatId)) {
      await sendMessage(chatId, `Send /start to register or /login to get a new access code.`);
      return;
    }
    const pending = await listPendingSubmissions(10);
    if (pending.length === 0) {
      await sendMessage(chatId, `Nothing pending right now.`);
      return;
    }
    for (const sub of pending) {
      await sendMessage(chatId, formatSubmission(sub), approvalKeyboard(sub._id.toString()));
    }
    return;
  }

  if (flow && flow.step === 'awaiting_answer') {
    if (parseInt(text, 10) === flow.answer) {
      await setBotFlow(chatId, { step: 'awaiting_username', handle: flow.handle });
      await sendMessage(chatId, `Correct ✅ Now send me your X (Twitter) username, e.g. @yourname`);
    } else {
      await setBotFlow(chatId, { step: 'idle', handle: flow.handle });
      await sendMessage(chatId, `Not quite — send /start to try again.`);
    }
    return;
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
        `You're registered as @${escapeMarkdown(handle)} 🎉 You'll show up on the site's participant list.\n\nYour access code:\n\`${code}\`\nTap it to copy — this logs you into the site, keep it like a password. Send /login anytime to get a new one (the old one stops working).\n\nWhen you're ready to enter the pool, send /submit with a link to your post or comment about a partner.`,
        null,
        'Markdown'
      );
    }
    return;
  }

  if (flow && flow.step === 'awaiting_submission_url') {
    const isUrl = /^https?:\/\/(x|twitter)\.com\//i.test(text);
    if (!isUrl) {
      await sendMessage(chatId, `That doesn't look like an X/Twitter link — send the full https:// URL of your post or comment.`);
      return;
    }
    await addSubmission(flow.handle, chatId, text);
    await setBotFlow(chatId, { step: 'idle', handle: flow.handle });
    await sendMessage(chatId, `Got it — your post is under review. You'll be notified once it's approved into the pool.`);

    if (ADMIN_CHAT_ID) {
      await sendMessage(ADMIN_CHAT_ID, `New entry from @${flow.handle}\n${text}`);
    }
    return;
  }

  await sendMessage(chatId, `Send /start to register or /login to get a new access code.`);
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data || '';

  if (!isAdmin(chatId)) {
    await answerCallbackQuery(callbackQuery.id, 'Not authorized.');
    return;
  }

  const [action, id] = data.split(':');
  if (!id || (action !== 'appr' && action !== 'rej')) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  const sub = await getSubmission(id);
  if (!sub) {
    await answerCallbackQuery(callbackQuery.id, 'Already handled.');
    return;
  }

  const status = action === 'appr' ? 'approved' : 'rejected';
  await setSubmissionStatus(id, status);
  await answerCallbackQuery(callbackQuery.id, status === 'approved' ? 'Approved' : 'Rejected');
  await editMessageText(
    chatId,
    messageId,
    `${formatSubmission(sub)}\n\n${status === 'approved' ? '✅ Approved' : '❌ Rejected'}`
  );

  if (sub.chatId) {
    const note =
      status === 'approved'
        ? `Your entry was approved ✅ You're in the current pool round.`
        : `Your entry wasn't approved this time. Feel free to /submit another one.`;
    await sendMessage(sub.chatId, note);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const update = req.body;

  try {
    if (update && update.message) {
      await handleMessage(update.message);
    } else if (update && update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error('bot-webhook error:', err);
  }

  res.status(200).send('ok');
};
