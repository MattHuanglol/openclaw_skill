#!/usr/bin/env node
/**
 * voice_confirm.js
 *
 * Handle confirmation/cancellation/modification of pending voice command drafts.
 *
 * Usage:
 *   node voice_confirm.js --request-id <id> --action execute|cancel|modify [--modify-text <text>]
 *
 * Output (JSON):
 *   {
 *     "ok": true|false,
 *     "action": "execute"|"cancel"|"modify",
 *     "requestId": "...",
 *     "commandToExecute": "/remind ..." or null,
 *     "transcript": "..." (original transcript),
 *     "error": "..." (only on failure)
 *   }
 *
 * Actions:
 *   - execute: Remove pending entry, return commandToExecute
 *   - cancel: Remove pending entry, return null for commandToExecute
 *   - modify: Use --modify-text as commandToExecute, remove pending entry
 */

const fs = require('fs');
const path = require('path');

const PENDING_STATE_FILE = path.join(process.env.HOME || '/tmp', '.clawd-voice-pending.json');

/**
 * Load pending drafts state
 */
function loadPendingState() {
  try {
    if (fs.existsSync(PENDING_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(PENDING_STATE_FILE, 'utf8'));
    }
  } catch (e) {
    // Non-fatal
  }
  return { pending: {} };
}

/**
 * Save pending drafts state
 */
function savePendingState(state) {
  fs.writeFileSync(PENDING_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = {
    requestId: null,
    action: null,
    modifyText: null,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];

    if (arg === '--request-id' && next) {
      args.requestId = next;
      i++;
    } else if (arg === '--action' && next) {
      args.action = next;
      i++;
    } else if (arg === '--modify-text' && next) {
      args.modifyText = next;
      i++;
    }
  }

  return args;
}

/**
 * Output result as JSON
 */
function output(result) {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Main handler
 */
function main() {
  const args = parseArgs();

  // Validate required args
  if (!args.requestId) {
    output({
      ok: false,
      action: null,
      requestId: null,
      commandToExecute: null,
      transcript: null,
      error: 'Missing required --request-id argument',
    });
    process.exit(1);
  }

  if (!args.action) {
    output({
      ok: false,
      action: null,
      requestId: args.requestId,
      commandToExecute: null,
      transcript: null,
      error: 'Missing required --action argument',
    });
    process.exit(1);
  }

  const validActions = ['execute', 'cancel', 'modify'];
  if (!validActions.includes(args.action)) {
    output({
      ok: false,
      action: args.action,
      requestId: args.requestId,
      commandToExecute: null,
      transcript: null,
      error: `Invalid action: ${args.action}. Must be one of: ${validActions.join(', ')}`,
    });
    process.exit(1);
  }

  if (args.action === 'modify' && !args.modifyText) {
    output({
      ok: false,
      action: args.action,
      requestId: args.requestId,
      commandToExecute: null,
      transcript: null,
      error: 'Missing required --modify-text argument for modify action',
    });
    process.exit(1);
  }

  // Load pending state
  const state = loadPendingState();
  const entry = state.pending[args.requestId];

  if (!entry) {
    output({
      ok: false,
      action: args.action,
      requestId: args.requestId,
      commandToExecute: null,
      transcript: null,
      error: `No pending draft found for requestId: ${args.requestId}`,
    });
    process.exit(1);
  }

  // Process based on action
  let commandToExecute = null;

  switch (args.action) {
    case 'execute':
      commandToExecute = entry.draftCommand;
      break;

    case 'cancel':
      commandToExecute = null;
      break;

    case 'modify':
      commandToExecute = args.modifyText;
      break;
  }

  // Remove the pending entry
  delete state.pending[args.requestId];
  savePendingState(state);

  // Output result
  output({
    ok: true,
    action: args.action,
    requestId: args.requestId,
    commandToExecute,
    commandType: entry.commandType || 'exec',
    transcript: entry.transcript,
  });

  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = {
  loadPendingState,
  savePendingState,
};
