// scripts/secrets.js
// Minimal secret loader for OpenClaw skills.
// Priority: process.env -> ~/.openclaw/secrets.env
// secrets.env format: KEY=VALUE (supports comments # and blank lines)

const fs = require('fs');
const path = require('path');

function parseSecretsEnv(content) {
  const out = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    // Strip optional quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadSecretsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    return parseSecretsEnv(content);
  } catch {
    return {};
  }
}

function getSecret(name) {
  if (process.env[name]) return process.env[name];
  const secretsPath = path.join(process.env.HOME || '/tmp', '.openclaw', 'secrets.env');
  const secrets = loadSecretsFile(secretsPath);
  return secrets[name] || null;
}

module.exports = {
  getSecret,
  parseSecretsEnv,
  loadSecretsFile,
};
