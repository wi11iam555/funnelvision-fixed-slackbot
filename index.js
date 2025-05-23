const { App } = require('@slack/bolt');
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.event('app_mention', async ({ event, say }) => {
  console.log("✅ Mention event triggered");
  await say(`Hi, I’m Funnel Vision 👁️`);
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Funnel Vision Slackbot is running!');
})();
