// Observe fatal failures without overriding Node's non-zero termination behavior.
// Expected connection failures belong to the captured bot's error/end handlers.
process.on('uncaughtExceptionMonitor', () => {
  console.error('[Process] Fatal uncaught error; terminating the backend.');
});
