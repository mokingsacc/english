// MCP tool annotations for the connector's tools (as in practice-hub): First Pass is a closed world, and a write that
// can be undone says destructive false so clients do not treat it as one.
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
export const UNDOABLE_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
