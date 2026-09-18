/**
 * Discord Gateway close codes.
 *
 * Discord.js-familiar names and numeric values, matching the Discord Gateway
 * protocol. Exposed so consumers can branch on named codes instead of magic
 * numbers; {@link Gateway} uses them internally to decide resume/identify/stop.
 */
export const GatewayCloseCodes = {
    UnknownError: 4000,
    UnknownOpcode: 4001,
    DecodeError: 4002,
    NotAuthenticated: 4003,
    AuthenticationFailed: 4004,
    AlreadyAuthenticated: 4005,
    InvalidSeq: 4007,
    RateLimited: 4008,
    SessionTimedOut: 4009,
    InvalidShard: 4010,
    ShardingRequired: 4011,
    InvalidAPIVersion: 4012,
    InvalidIntents: 4013,
    DisallowedIntents: 4014,
} as const;
