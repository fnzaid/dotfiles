/** Everything the extension remembers while one Pi session runs. */

import type { DrillConfig } from "./config.ts";
import type { Grant } from "./gate.ts";
import type { ReminderState } from "./reminder.ts";

export interface DrillState {
  /** True when Pi was started with `--drill-off`. Every handler stands down. */
  off: boolean;
  config: DrillConfig;
  /** `config.bashAllow`, compiled once per session. */
  bashAllow: RegExp[];
  /** The open grant, if he ran `/boilerplate` or `/refactor` for the current request. */
  grant: Grant | undefined;
  reminder: ReminderState;
  /** Absolute path of the learning log. */
  logFile: string;
  /** The clock. Injected so tests can pick the date. */
  now: () => Date;
}
