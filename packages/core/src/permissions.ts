/**
 * Permission bits and math live in `@lunibee/structures`, which needs them at
 * runtime (member and role permissions); they are re-exported here unchanged.
 */
export {
    Permission,
    Permissions,
    PermissionFlagsBits,
    PermissionSet,
    PermissionsBitField,
    PermissionOverwriteEnum,
    computePermissions,
    type PermissionContext,
    type PermissionOverwrite,
    type PermissionRole,
    type PermissionName,
    type PermissionResolvable,
} from "@lunibee/structures";
