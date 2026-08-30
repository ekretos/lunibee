import { REST, type RetryPolicy } from "@lunibee/rest";

/** A recorded REST request used by integration-style tests. */
export interface RecordedRequest {
  /** HTTP method. */ method: string;
  /** API path. */ path: string;
  /** Request body. */ body?: unknown;
}

/** Lightweight mock REST transport that records calls while returning configured values. */
export class MockREST extends REST {
  /** Recorded requests in invocation order. */
  public readonly requests: RecordedRequest[] = [];
  readonly #responses = new Map<string, unknown>();
  /** Creates a mock REST transport. @param responses Optional path-to-response map. @param retryPolicy Optional retry policy. @throws {Error} If REST initialization fails. */
  public constructor(
    responses: Record<string, unknown> = {},
    retryPolicy?: RetryPolicy,
  ) {
    super({ baseURL: "https://test.invalid", retryPolicy });
    for (const [path, response] of Object.entries(responses))
      this.#responses.set(path, response);
  }
  /** Records and returns a configured response. @param method HTTP method. @param path API path. @param body Optional request body. @returns Configured response. @throws {Error} If no configured response exists. */
  public override async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.requests.push({ method, path, body });
    if (!this.#responses.has(path))
      throw new Error(`No mock response configured for ${path}`);
    return this.#responses.get(path) as T;
  }
}
