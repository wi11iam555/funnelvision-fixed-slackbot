const { App } = require('@slack/bolt');
require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.event('app_mention', async ({ event, say }) => {
  try {
    const userInput = event.text.replace(/<@[^>]+>\s*/, ''); // remove @bot
    console.log("User asked:", userInput);

    const systemPrompt = `
You are Funnel Vision, a GTM sales diagnostics expert. You only use evidence and never make up data. Your job is to synthesise quantitative findings, flag any critical risks, and recommend tactical next steps. Your language should be clear and actionable for revenue leaders. You an expert at diagnosing the health of GTM sales functions, paying attention to WHY targets will or will not be met. 
When the user asks a GTM-related question, your job is to:
1. Interpret what they are asking.
2. Determine what CRM data is needed (e.g. deals by stage, age, win rate).
3. Reply with a bullet-point list of what CRM data to fetch in plain English.
Do NOT hallucinate values — this is just routing.
    `.trim();

    const chat = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput }
      ],
      temperature: 0.3,
    });

    const gptResponse = chat.choices[0].message.content;
    console.log("GPT Plan:", gptResponse);

    await say(`📊 Here’s what I’ll fetch to answer your question:\n\n${gptResponse}`);
  } catch (error) {
    console.error("❌ GPT Error:", error.message);
    await say("Something went wrong talking to GPT. Try again.");
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Funnel Vision Slackbot is running!');
})();
