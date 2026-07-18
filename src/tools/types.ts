// S3.1 — Data-driven tool definition. Adding a tool means registering another
// ToolSpec; the agent loop never changes.

export interface ToolSpec {
  /** Function name the model calls (e.g. "read_file"). */
  name: string;
  /** Shown to the model — say what it does and when to use it. */
  description: string;
  /** JSON Schema describing the arguments object. */
  parameters: Record<string, unknown>;
  /**
   * Run the tool. `args` is the JSON-parsed arguments value from the model.
   * Must resolve to a string for the role:"tool" message — implementations
   * should return error text rather than throw, so the model can recover.
   */
  execute(args: unknown): Promise<string>;
}
