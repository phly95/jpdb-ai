const http = require('http');
const https = require('https');
const fs = require('fs');

// Primary AI backend router config
let config = {
  jevEndpoint: 'https://openrouter.ai/api/alpha/decisions',
  jevModel: 'typesafe/jev-1.13',
  jevKey: 'YOUR_API_KEY',
  llmBase: 'http://100.117.72.11:20128/v1',
  llmModel: 'ag/gemini-3.8-flash-low',
  llmKey: 'sk-32c602f2a3bf0a64-sc09zk-98456489'
};

function postJson(urlStr, headers, bodyObj, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'http:' ? http : https;
    const data = JSON.stringify(bodyObj);
    const defaultPort = url.protocol === 'http:' ? 80 : 443;
    const options = {
      hostname: url.hostname,
      port: url.port || defaultPort,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: timeoutMs
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callJev(state, questions) {
  const t0 = Date.now();
  const endpoint = config.jevEndpoint;
  const headers = {
    'Authorization': `Bearer ${config.jevKey}`,
    'HTTP-Referer': 'https://jpdb.io',
    'X-Title': 'JPDB AI Explainer Prototype'
  };

  const body = {
    model: config.jevModel,
    state,
    questions
  };

  const res = await postJson(endpoint, headers, body);
  const elapsedMs = Date.now() - t0;
  return {
    answers: res.data.answers,
    usage: res.data.usage,
    elapsedMs,
    id: res.data.id
  };
}

async function callLlm(messages) {
  const t0 = Date.now();
  const url = `${config.llmBase}/chat/completions`;
  const headers = {
    'Authorization': `Bearer ${config.llmKey}`
  };
  const body = {
    model: config.llmModel,
    messages,
    stream: false
  };

  const res = await postJson(url, headers, body);
  const elapsedMs = Date.now() - t0;
  return {
    content: res.data.choices?.[0]?.message?.content || '',
    usage: res.data.usage,
    elapsedMs
  };
}

module.exports = {
  callJev,
  callLlm,
  config
};
