const axios = require('axios');
const {
  buildChatCompletionMessages,
  extractChatCompletionContent
} = require('./common');

const OPENAI_API_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getConfig() {
  return {
    provider: 'openai',
    label: 'OpenAI API',
    baseUrl: OPENAI_API_URL,
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY)
  };
}

async function complete({ prompt, systemPrompt, temperature, timeoutMs }) {
  const config = getConfig();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await axios.post(`${config.baseUrl}/chat/completions`, {
    model: config.model,
    temperature,
    messages: buildChatCompletionMessages(prompt, systemPrompt)
  }, {
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return extractChatCompletionContent(response.data);
}

module.exports = {
  complete,
  getConfig
};
