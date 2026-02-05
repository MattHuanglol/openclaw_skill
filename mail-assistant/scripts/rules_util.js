const fs = require('node:fs');
const path = require('node:path');

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

function defaultRulesPath() {
  return path.join(process.env.HOME || '', '.openclaw', 'mail-assistant.rules.json');
}

function loadRules(rulesPath) {
  const p = expandHome(rulesPath || process.env.MAIL_ASSISTANT_RULES || defaultRulesPath());
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(txt);
    return { path: p, rules: j };
  } catch {
    return { path: p, rules: null };
  }
}

function isEmptyRules(rules) {
  if (!rules || typeof rules !== 'object') return true;
  const imp = rules.important_unread;
  const daily = rules.daily_summary;
  const hasImp = !!(imp && imp.enabled && Array.isArray(imp.match_any) && imp.match_any.length);
  const hasDaily = !!(daily && daily.enabled);
  return !(hasImp || hasDaily);
}

function includesAny(hay, needles) {
  const s = String(hay || '').toLowerCase();
  if (!Array.isArray(needles) || needles.length === 0) return false;
  return needles.some(n => s.includes(String(n || '').toLowerCase()));
}

function matchRule(env, rule) {
  if (!rule || rule.enabled === false) return false;
  const from = `${env.from?.name || ''} ${env.from?.addr || ''}`;
  const to = `${env.to?.name || ''} ${env.to?.addr || ''}`;
  const subject = env.subject || '';
  const flags = Array.isArray(env.flags) ? env.flags : [];

  if (Array.isArray(rule.flags_required) && rule.flags_required.some(f => !flags.includes(f))) return false;
  if (Array.isArray(rule.flags_forbidden) && rule.flags_forbidden.some(f => flags.includes(f))) return false;

  // envelope doesn't include body; body_contains can't be evaluated here.
  if (Array.isArray(rule.body_contains) && rule.body_contains.length) {
    // treat as non-match for now; future enhancement could read message bodies.
    return false;
  }

  if (Array.isArray(rule.from_contains) && rule.from_contains.length && !includesAny(from, rule.from_contains)) return false;
  if (Array.isArray(rule.to_contains) && rule.to_contains.length && !includesAny(to, rule.to_contains)) return false;
  if (Array.isArray(rule.subject_contains) && rule.subject_contains.length && !includesAny(subject, rule.subject_contains)) return false;

  return true;
}

module.exports = {
  defaultRulesPath,
  loadRules,
  isEmptyRules,
  matchRule,
};
