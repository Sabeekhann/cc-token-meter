import fs from 'node:fs';
import path from 'node:path';

const START_TIME_MS = Date.parse('2026-01-01T00:00:00.000Z');

/**
 * Generate deterministic usage-only Claude Code JSONL fixtures. The records
 * contain no prompts, tool calls/results, usernames, or real project paths.
 */
export function writeSyntheticHistory(directory, options = {}) {
  const sessionCount = positiveInteger(options.sessionCount, 20);
  const messageCount = positiveInteger(options.messageCount, 50_000);
  fs.mkdirSync(directory, { recursive: true });

  const files = [];
  let globalIndex = 0;
  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const count = Math.floor(messageCount / sessionCount) +
      (sessionIndex < messageCount % sessionCount ? 1 : 0);
    const filePath = path.join(
      directory,
      `synthetic-session-${String(sessionIndex).padStart(3, '0')}.jsonl`,
    );
    const lines = [];
    for (let messageIndex = 0; messageIndex < count; messageIndex += 1) {
      lines.push(JSON.stringify(syntheticAssistantRecord({ sessionIndex, globalIndex })));
      globalIndex += 1;
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
    files.push({
      filePath,
      projectDirName: `-synthetic-project-${String(sessionIndex % 4).padStart(2, '0')}`,
      sessionIndex,
      messageCount: count,
    });
  }

  return { files, messageCount, sessionCount, nextGlobalIndex: globalIndex };
}

export function appendSyntheticMessage(file, globalIndex) {
  fs.appendFileSync(
    file.filePath,
    `${JSON.stringify(syntheticAssistantRecord({ sessionIndex: file.sessionIndex, globalIndex }))}\n`,
    'utf8',
  );
}

export function syntheticAssistantRecord({ sessionIndex, globalIndex }) {
  const even = globalIndex % 2 === 0;
  const inputTokens = 80 + (globalIndex * 17) % 420;
  const outputTokens = 20 + (globalIndex * 11) % 180;
  const cacheCreationInputTokens = globalIndex % 5 === 0 ? 120 : 0;
  const cacheReadInputTokens = globalIndex % 3 === 0 ? 240 : 0;
  return {
    type: 'assistant',
    sessionId: `synthetic-session-${String(sessionIndex).padStart(3, '0')}`,
    timestamp: new Date(START_TIME_MS + globalIndex * 1_000).toISOString(),
    cwd: `/synthetic/workspace/project-${String(sessionIndex % 4).padStart(2, '0')}`,
    gitBranch: even ? 'synthetic-main' : 'synthetic-feature',
    version: 'synthetic-1.0.0',
    message: {
      model: globalIndex % 3 === 0 ? 'claude-haiku-4' : 'claude-sonnet-5',
      content: [],
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation: {
          ephemeral_5m_input_tokens: cacheCreationInputTokens,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
