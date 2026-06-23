# Runtime adapter notes

A Loop Engine adapter should expose a small event interface:

```ts
type LoopPhase = "observe" | "plan" | "execute" | "critique" | "publish";

interface LoopEvent {
  phase: LoopPhase;
  intent: string;
  evidence: Array<{ uri: string; sha256?: string }>;
  artifacts: Array<{ path: string; sha256: string }>;
  checks: Array<{ name: string; result: "pass" | "fail" | "warn"; detail?: string }>;
}
```

The adapter can be implemented for CLI agents, browser agents, or multi-agent review runs.
