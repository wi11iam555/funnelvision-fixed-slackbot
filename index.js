const { App } = require('@slack/bolt');
require('dotenv').config();
const OpenAI = require('openai');
const hubspot = require('@hubspot/api-client');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// 🧱 Handler: Fetch deals stuck for over 30 days
async function fetchStuckDeals() {
  const hs = new hubspot.Client({ accessToken: process.env.HUBSPOT_API_KEY });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const timestampCutoff = thirtyDaysAgo.toISOString();

  const filterGroup = {
    filters: [
      { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
      { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' },
      { propertyName: 'hs_lastmodifieddate', operator: 'LT', value: timestampCutoff }
    ]
  };

  const request = {
    filterGroups: [filterGroup],
    sorts: ['hs_lastmodifieddate'],
    properties: ['dealname', 'dealstage', 'amount', 'hs_lastmodifieddate', 'pipeline'],
    limit: 20
  };

  const results = await hs.crm.deals.searchApi.doSearch({ body: request });
  return results.results || [];
}

// 🧱 Handler: Calculate pipeline coverage
async function getPipelineCoverage({ target = 500000 }) {
  const hs = new hubspot.Client({ accessToken: process.env.HUBSPOT_API_KEY });

  const filter = {
    filters: [
      { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
      { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' }
    ]
  };

  const request = {
    filterGroups: [filter],
    properties: ['amount', 'dealstage'],
    limit: 100
  };

  const results = await hs.crm.deals.searchApi.doSearch({ body: request });
  const openDeals = results.results || [];

  const pipelineValue = openDeals.reduce((sum, deal) => {
    const amount = parseFloat(deal.properties.amount || 0);
    return sum + amount;
  }, 0);

  const coverageRatio = pipelineValue / target;

  return {
    target,
    pipelineValue,
    coverageRatio,
    dealCount: openDeals.length
  };
}

// 🔁 Main bot logic
app.event('app_mention', async ({ event, say }) => {
  try {
    const userInput = event.text.replace(/<@[^>]+>\s*/, '').toLowerCase();

    if (userInput.includes('pipeline')) {
      const stats = await getPipelineCoverage({ target: 500000 });

      const summary = `
Team target: €${stats.target.toLocaleString()}
Open pipeline: €${stats.pipelineValue.toLocaleString()}
Coverage ratio: ${stats.coverageRatio.toFixed(2)}x
Total open deals: ${stats.dealCount}
`;

      const prompt = `
You are Funnel Vision, a GTM sales diagnostics expert. You only use evidence and never make up data. Your job is to synthesise quantitative findings, flag any critical risks, and recommend tactical next steps. Your language should be clear and actionable for revenue leaders. You an expert at diagnosing the health of GTM sales functions, paying attention to WHY targets will or will not be met. 
Given this pipeline data, explain whether the team has enough pipeline to hit target.
Be direct. Use 3 bullet points + a short recommendation.
Only use the data below. Don’t invent anything.

${summary}
`.trim();

      const gpt = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: prompt }
        ],
        temperature: 0.3
      });

      await say(`📊 *Pipeline Coverage Analysis:*\n\n${gpt.choices[0].message.content}`);
      return;
    }

    // fallback: show stuck deals
    const systemPrompt = `
You are Funnel Vision, a GTM sales diagnostics expert. You only use evidence and never make up data. Your job is to synthesise quantitative findings, flag any critical risks, and recommend tactical next steps. Your language should be clear and actionable for revenue leaders. You an expert at diagnosing the health of GTM sales functions, paying attention to WHY targets will or will not be met. 
You will receive a list of stuck deals.
Interpret why these deals might be blocking revenue and suggest actions.
Use only the data provided. Be crisp and structured.
`.trim();

    const deals = await fetchStuckDeals();

    const formatted = deals.map(d => {
      return `• "${d.properties.dealname}" — Stage: ${d.properties.dealstage}, Amount: ${d.properties.amount}, Last updated: ${d.properties.hs_lastmodifieddate}`;
    }).join('\n');

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here are 20 stuck deals:\n${formatted}` }
      ],
      temperature: 0.3
    });

    await say(`📉 *Stuck Deals Analysis:*\n\n${response.choices[0].message.content}`);

  } catch (error) {
    console.error("❌ Error:", error.message);
    await say("Something went wrong analyzing the pipeline.");
  }
});

// 🚀 Start the bot
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Funnel Vision Slackbot is running!');
})();
