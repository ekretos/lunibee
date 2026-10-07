/**
 * Channel kinds: a short name for what a channel is, in place of the numeric
 * `type` Discord sends. Threads share one kind; `type` still tells the three
 * apart.
 */
export const ChannelKinds = {
    text: [0],
    dm: [1],
    voice: [2],
    "group-dm": [3],
    category: [4],
    announcement: [5],
    thread: [10, 11, 12],
    stage: [13],
    directory: [14],
    forum: [15],
    media: [16],
} as const;

/** The name of a kind of channel, such as `"text"` or `"voice"`. */
export type ChannelKind = keyof typeof ChannelKinds;

/** A channel type Discord has no kind for yet. */
export type UnknownChannelKind = "unknown";

const KIND_OF_TYPE = new Map<number, ChannelKind>(
    (Object.keys(ChannelKinds) as ChannelKind[]).flatMap((kind) =>
        ChannelKinds[kind].map((type): [number, ChannelKind] => [type, kind]),
    ),
);

/** The kind of a Discord channel `type`, or `"unknown"` for a type this version does not know. */
export function channelKindOf(type: number): ChannelKind | UnknownChannelKind {
    return KIND_OF_TYPE.get(type) ?? "unknown";
}

/** The Discord channel `type` numbers a kind covers (three for `"thread"`, one for the rest). */
export function channelTypesOf(kind: ChannelKind): readonly number[] {
    return ChannelKinds[kind];
}
