import {REMINDER} from '../src/instructions.mjs';
if(process.env.ORCA_STRUCTURED_SESSION && process.env.ORCA_AGENT_SESSION_ID) {
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:REMINDER}}));
}
