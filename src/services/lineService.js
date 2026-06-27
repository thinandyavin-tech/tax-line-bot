const line = require('@line/bot-sdk');

let client;

function getClient() {
  if (!client) {
    client = new line.messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
  }
  return client;
}

async function getUserProfile(userId) {
  try {
    return await getClient().getProfile(userId);
  } catch {
    return { displayName: 'ลูกค้า', userId };
  }
}

async function getMessageImageBuffer(messageId) {
  const blobClient = new line.messagingApi.MessagingApiBlobClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
  const stream = await blobClient.getMessageContent(messageId);
  return streamToBuffer(stream);
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function replyText(replyToken, text) {
  return getClient().replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

async function replyMessages(replyToken, messages) {
  return getClient().replyMessage({ replyToken, messages });
}

module.exports = { getUserProfile, getMessageImageBuffer, replyText, replyMessages };
