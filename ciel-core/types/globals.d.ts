// Ambient declarations for the runtimes the standalone surface supports.
// Only what ciel-core/server actually touches; everything else is injected.
declare const Deno: {
  serve(options: { port?: number; hostname?: string }, handler: (req: Request) => Promise<Response> | Response): { shutdown(): void };
  version?: { deno: string };
};

declare const Bun: {
  serve(options: { port?: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }): { port: number; stop(force?: boolean): void };
  version?: string;
};
