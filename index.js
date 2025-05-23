const { App } = require('@slack/bolt');
const { Configuration, OpenAIApi } = require("openai");
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

app.event('app_mention', async ({ event, say }) => {
  try {
    const userInput = event.text.replace(/<@[^>]+>\s*/, ''); // Remove bot mention
    console.log("User asked:", userInput);

    const systemPrompt = `
You are Funnel Vision, a senior RevOps strategist.
When the user asks a GTM-related question, your job is to:
1. Interpret what they are asking.
2. Determine what CRM data is needed (e.g. deals by stage, age, win rate).
3. Reply with a bullet-point list of what CRM data to fetch in plain English.
Do NOT hallucinate values — this is just routing.
`;

    const response = await openai.createChatCompletion({
      model: "gpt-4",  // Use "gpt-3.5-turbo" if GPT-4 is unavailable
      messages: [
        { role: "system", content: systemPrompt.trim() },
        { role: "user", content: userInput }
      ],
      temperature: 0.3,
    });

    const gptPlan = response.data.choices[0].message.content;
    console.log("🧠 GPT Response:\n", gptPlan);

    await say(`📊 Here’s what I’ll fetch to answer your question:\n\n${gptPlan}`);
  } catch (err) {
    console.error("Error:", err.message);
    await say("Something went wrong. Please try again.");
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Funnel Vision Slackbot is running!');
})();
