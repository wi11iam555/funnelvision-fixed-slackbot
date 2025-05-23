
const { App } = require('@slack/bolt');
require('dotenv').config();
const OpenAI = require('openai');
const hubspot = require('@hubspot/api-client');

// Init GPT + HubSpot clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const hubspotClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_API_KEY });

// In-memory context store
const userContext = {};

// Default open stage IDs (customized for this HubSpot instance)
const OPEN_STAGE_IDS = [
  "665585897", // Lead
  "947645674", // Discovery
  "947645675", // Demo
  "751368910", // Solution Confirmation
  "691456745"  // Negotiation
];

// Default timeframe: Q2 2025
const DEFAULT_TIMEFRAME = {
  label: "Q2 2025",
  start: "2025-04-01",
  end: "2025-06-30"
};

// Utilities to get/set context
function setUserContext(userId, updates) {
  if (!userContext[userId]) userContext[userId] = {};
  Object.assign(userContext[userId], updates);
}

function getUserContext(userId) {
  return userContext[userId] || {};
}

// Detect target and timeframe from user input using GPT
async function extractContextFromMessage(userId, message) {
  const systemPrompt = `
You are Funnel Vision, a GTM sales diagnostics expert. You only use evidence and never make up data. Your job is to synthesise quantitative findings, flag any critical risks, and recommend tactical next steps. Your language should be clear and actionable for revenue leaders. You an expert at diagnosing the health of GTM sales functions, paying attention to WHY targets will or will not be met. 
Given a user's message, extract three things if possible:
1. Target revenue in EUR (e.g. "€500k", "500000")
2. Timeframe (e.g. "Q2", "next 30 days", "this month")
3. Any missing information that will inform your response 

Respond in JSON:
{
  "target": number | null,
  "timeframe": "label (e.g. Q2)" | null,
  "start": "YYYY-MM-DD" | null,
  "end": "YYYY-MM-DD" | null
}
If not found, use null. Do not guess or hallucinate.
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ],
    temperature: 0
  });

  try {
    const json = JSON.parse(response.choices[0].message.content);
    const ctx = {};

    if (json.target) ctx.target = json.target;
    if (json.timeframe && json.start && json.end) {
      ctx.timeframe = json.timeframe;
      ctx.timeframeRange = { start: json.start, end: json.end };
    }

    if (Object.keys(ctx).length > 0) {
      setUserContext(userId, ctx);
    }

    return ctx;
  } catch (err) {
    console.error("Failed to parse context JSON:", err.message);
    return {};
  }
}

// HubSpot API: Get pipeline coverage
async function getPipelineCoverage({ target, timeframe }) {
  const filterGroup = {
    filters: [
      { propertyName: "dealstage", operator: "IN", values: OPEN_STAGE_IDS },
      { propertyName: "amount", operator: "GT", value: "0" }
    ]
  };

  if (timeframe?.start && timeframe?.end) {
    filterGroup.filters.push({
      propertyName: "closedate",
      operator: "BETWEEN",
      values: [timeframe.start, timeframe.end]
    });
  }

  const request = {
    filterGroups: [filterGroup],
    properties: ["amount", "dealstage", "closedate"],
    limit: 100
  };

  const results = await hubspotClient.crm.deals.searchApi.doSearch({ body: request });
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

// Slackbot main logic
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.event('app_mention', async ({ event, say }) => {
  const userId = event.user;
  const userInput = event.text.replace(/<@[^>]+>/, "").trim();

  try {
    // Step 1: Try to extract context from message
    await extractContextFromMessage(userId, userInput);
    const ctx = getUserContext(userId);

    // Step 2: If user is asking about pipeline but hasn't set target/timeframe
    if (userInput.toLowerCase().includes("pipeline")) {
      const missingTarget = !ctx.target;
      const missingTimeframe = !ctx.timeframeRange;

      if (missingTarget || missingTimeframe) {
        const clarifyMsg = [];

        if (missingTarget) clarifyMsg.push("target (e.g. €500000)");
        if (missingTimeframe) clarifyMsg.push("timeframe (e.g. Q2 or this month)");

        await say(`🔍 To answer that, I need your \${clarifyMsg.join(" and ")}. Just reply in one message.`);
        return;
      }

      const stats = await getPipelineCoverage({
        target: ctx.target,
        timeframe: ctx.timeframeRange
      });

      const summary = `
Team target: €\${ctx.target.toLocaleString()}
Open pipeline (\`${ctx.timeframe}`): €\${stats.pipelineValue.toLocaleString()}
Coverage ratio: \${stats.coverageRatio.toFixed(2)}x
Total open deals: \${stats.dealCount}
`;

      const prompt = `
You are Funnel Vision, a GTM sales diagnostics expert. You only use evidence and never make up data. Your job is to synthesise quantitative findings, flag any critical risks, and recommend tactical next steps. Your language should be clear and actionable for revenue leaders. You an expert at diagnosing the health of GTM sales functions, paying attention to WHY targets will or will not be met. 
Given this pipeline summary, assess whether the team will hit their target.
Return 3 bullet points and a short recommendation.
Only use the data below.

\${summary}
`.trim();

      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: prompt }
        ],
        temperature: 0.3
      });

      await say(`📊 *Pipeline Coverage Analysis:*

\${response.choices[0].message.content}`);
      return;
    }

    // Fallback: Store anything helpful
    await say("✅ Got it. If you ask me about pipeline or performance, I’ll use that info.");

  } catch (err) {
    console.error("❌ Error in Slack handler:", err.message);
    await say("Something went wrong trying to analyze that.");
  }
});

// Start app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡️ Funnel Vision bot is running");
})();
