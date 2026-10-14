/**
 * Test rig: a real Pi session with drill loaded, driven by Pi's scripted "faux" model.
 *
 * Nothing here is mocked except the model's replies. Tool calls go through Pi's own tool
 * pipeline and touch a real temporary project on disk, so a passing gate test means the
 * file really was not written.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FauxProviderRegistration, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createDrill } from "../src/index.ts";
import { type DrillRecord, logFile, readLog } from "../src/log.ts";

/** The tools the model has when no grant is open. */
export const MENTOR_TOOLS = ["read", "bash", "drill_log", "grep", "find", "ls"];

export interface RigOptions {
  /** Files to create in the project, by relative path. */
  files?: Record<string, string>;
  /** Contents of the project's `.pi/drill.json`. */
  config?: unknown;
  /** Start Pi with `--drill-off`. */
  off?: boolean;
  now?: () => Date;
  /** Extra extensions, loaded after drill. */
  extensions?: ExtensionFactory[];
  /** Pi settings for the session. */
  settings?: Parameters<typeof SettingsManager.inMemory>[0];
}

export interface Rig {
  project: string;
  session: AgentSession;
  faux: FauxProviderRegistration;
  /** Every message drill showed him through `ctx.ui.notify`. */
  notes: string[];
  records(): DrillRecord[];
  /** Text of every message with the given role, in order. */
  texts(role: string): string[];
  /**
   * Sends input that starts a run without waiting for it, such as a slash command that
   * prompts the model, and resolves once Pi has fully settled.
   */
  run(input: string): Promise<void>;
  dispose(): void;
}

/** A UI that records notifications and ignores everything else. */
function recordingUi(notes: string[]): ExtensionUIContext {
  const ui = {
    notify: (message: string): void => {
      notes.push(message);
    },
  };
  // The session only needs the methods drill calls. Any other member is a no-op function.
  return new Proxy(ui, {
    get: (target, key): unknown => (key in target ? Reflect.get(target, key) : () => undefined),
  }) as unknown as ExtensionUIContext;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
}

function writeProjectFiles(project: string, options: RigOptions): void {
  const files = { ...options.files };
  if (options.config !== undefined) files[".pi/drill.json"] = JSON.stringify(options.config);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  }
}

/** Registers Pi's scripted model and a model runtime that knows it. */
export async function fauxRuntime(
  agentDir: string,
): Promise<{ faux: FauxProviderRegistration; runtime: ModelRuntime }> {
  const faux = registerFauxProvider();
  const model = faux.getModel();
  // Point every store at the temporary agent directory so a test never reads his real credentials.
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"),
  });
  runtime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: "faux-key",
    api: faux.api,
    models: faux.models.map((entry) => ({
      id: entry.id,
      name: entry.name,
      api: entry.api,
      reasoning: entry.reasoning,
      input: entry.input,
      cost: entry.cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      baseUrl: entry.baseUrl,
    })),
  });
  return { faux, runtime };
}

/** Starts a session in a fresh temporary project. Call `dispose()` when done. */
export async function createRig(options: RigOptions = {}): Promise<Rig> {
  const project = mkdtempSync(join(tmpdir(), "drill-e2e-"));
  const agentDir = mkdtempSync(join(tmpdir(), "drill-e2e-agent-"));
  writeProjectFiles(project, options);

  const { faux, runtime } = await fauxRuntime(agentDir);
  const drill = createDrill({ agentDir, ...(options.now ? { now: options.now } : {}) });
  const resourceLoader = new DefaultResourceLoader({
    cwd: project,
    agentDir,
    extensionFactories: [drill, ...(options.extensions ?? [])],
  });
  await resourceLoader.reload();

  const { session, extensionsResult } = await createAgentSession({
    cwd: project,
    agentDir,
    model: faux.getModel(),
    modelRuntime: runtime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(options.settings),
  });
  if (options.off === true) extensionsResult.runtime.flagValues.set("drill-off", true);

  const notes: string[] = [];
  await session.bindExtensions({ uiContext: recordingUi(notes) });

  return {
    project,
    session,
    faux,
    notes,
    records: () => readLog(logFile(agentDir)).records,
    texts: (role) =>
      session.messages
        .filter((message) => message.role === role)
        .map((message) => textOf((message as { content?: unknown }).content)),
    run: async (input) => {
      const settled = new Promise<void>((resolve) => {
        const unsubscribe = session.subscribe((event) => {
          if (event.type !== "agent_settled") return;
          unsubscribe();
          resolve();
        });
      });
      await session.prompt(input);
      await settled;
    },
    dispose: () => {
      session.dispose();
      faux.unregister();
      rmSync(project, { recursive: true });
      rmSync(agentDir, { recursive: true });
    },
  };
}
