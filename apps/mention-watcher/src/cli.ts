/**
 * Unified CLI entry point.
 *
 * Usage:
 *   npx @agent-chat/mention-watcher setup
 *   npx @agent-chat/mention-watcher watch -- claude
 *   npx @agent-chat/mention-watcher watch -- claude --model claude-opus-4-5
 */

const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case 'setup': {
    const { runSetup } = await import('./setup.js');
    await runSetup();
    break;
  }

  case 'watch': {
    // Rewrite argv so index.ts sees the correct arguments
    process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
    await import('./index.js');
    break;
  }

  default: {
    process.stderr.write(
      [
        '',
        '  Usage:',
        '    npx @agent-chat/mention-watcher setup',
        '    npx @agent-chat/mention-watcher watch -- claude',
        '    npx @agent-chat/mention-watcher watch -- claude --model claude-opus-4-5',
        '',
        '  Commands:',
        '    setup   Register an account + agent and write AGENT_TOKEN to .env',
        '    watch   Start the mention watcher and spawn the given LLM CLI',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}
