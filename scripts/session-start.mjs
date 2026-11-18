import { INSTRUCTIONS } from '../src/instructions.mjs';

// Only Orca's native chats; other Claude sessions receive no extra instructions.
if (process.env.ORCA_STRUCTURED_SESSION && process.env.ORCA_AGENT_SESSION_ID) {
  process.stdout.write(JSON.stringify({hookSpecificOutput: {
    hookEventName: 'SessionStart', additionalContext: INSTRUCTIONS
  }}));
}
