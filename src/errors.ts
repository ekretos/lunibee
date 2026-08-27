export class LunibeeError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "LunibeeError";
    }
}

export class RESTError extends LunibeeError {
    public readonly status: number;
    public readonly code?: number;
    public readonly errors?: unknown;

    public constructor(message: string, status: number, code?: number, errors?: unknown) {
        super(message);
        this.name = "RESTError";
        this.status = status;
        this.code = code;
        this.errors = errors;
    }
}

export class GatewayError extends LunibeeError {
    public readonly code?: number;

    public constructor(message: string, code?: number) {
        super(message);
        this.name = "GatewayError";
        this.code = code;
    }
}
