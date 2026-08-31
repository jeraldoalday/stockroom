// A structured (JSON-lines) logger, not a new dependency. Every field a
// production incident needs to grep for — request id, status, duration,
// which org and user — is a top-level JSON key instead of buried in a
// freeform string, so any log aggregator (CloudWatch, Railway's log view,
// `jq` over a file) can filter on it without a parsing library on either
// end. That's what "structured" means here; it doesn't require pulling in
// pino or winston for an app this size.

export type LogFields = Record<string, unknown>;

function write(level: "info" | "error", message: string, fields: LogFields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
