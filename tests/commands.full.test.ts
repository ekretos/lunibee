import { describe, expect, test } from "bun:test";
import {
  SlashCommandBuilder,
  StringOptionBuilder,
  IntegerOptionBuilder,
  NumberOptionBuilder,
  BooleanOptionBuilder,
  UserOptionBuilder,
  ChannelOptionBuilder,
  RoleOptionBuilder,
  MentionableOptionBuilder,
  AttachmentOptionBuilder,
  SubcommandBuilder,
  SubcommandGroupBuilder,
} from "../packages/builders/src/index.ts";

describe("Commands Options & Subcommands Full Coverage", () => {
  test("covers all option builder setters and validations", () => {
    const strOpt = new StringOptionBuilder()
      .setName("str")
      .setDescription("string desc")
      .setRequired(false)
      .setMinLength(1)
      .setMaxLength(50)
      .setAutocomplete(true);
    expect(strOpt.toJSON().name).toBe("str");
    expect(() => strOpt.setMinLength(100).setMaxLength(10)).toThrow();

    const intOpt = new IntegerOptionBuilder()
      .setName("int")
      .setDescription("integer desc")
      .setMinValue(0)
      .setMaxValue(100)
      .setAutocomplete(true);
    expect(intOpt.toJSON().name).toBe("int");
    expect(() => intOpt.setMinValue(100).setMaxValue(10)).toThrow();

    const numOpt = new NumberOptionBuilder()
      .setName("num")
      .setDescription("number desc")
      .setMinValue(0.5)
      .setMaxValue(99.5)
      .setAutocomplete(true);
    expect(numOpt.toJSON().name).toBe("num");

    const boolOpt = new BooleanOptionBuilder()
      .setName("bool")
      .setDescription("boolean desc");
    expect(boolOpt.toJSON().name).toBe("bool");

    const userOpt = new UserOptionBuilder()
      .setName("usr")
      .setDescription("user desc");
    expect(userOpt.toJSON().name).toBe("usr");

    const chanOpt = new ChannelOptionBuilder()
      .setName("chn")
      .setDescription("channel desc")
      .addChannelTypes(0, 2);
    expect(chanOpt.toJSON().name).toBe("chn");

    const roleOpt = new RoleOptionBuilder()
      .setName("rol")
      .setDescription("role desc");
    expect(roleOpt.toJSON().name).toBe("rol");

    const mentOpt = new MentionableOptionBuilder()
      .setName("mnt")
      .setDescription("mentionable desc");
    expect(mentOpt.toJSON().name).toBe("mnt");

    const attOpt = new AttachmentOptionBuilder()
      .setName("att")
      .setDescription("attachment desc");
    expect(attOpt.toJSON().name).toBe("att");

    const sub = new SubcommandBuilder()
      .setName("sub")
      .setDescription("subcommand desc")
      .addStringOption((o) => o.setName("s").setDescription("s"))
      .addIntegerOption((o) => o.setName("i").setDescription("i"))
      .addNumberOption((o) => o.setName("n").setDescription("n"))
      .addBooleanOption((o) => o.setName("b").setDescription("b"))
      .addUserOption((o) => o.setName("u").setDescription("u"))
      .addChannelOption((o) => o.setName("c").setDescription("c"))
      .addRoleOption((o) => o.setName("r").setDescription("r"))
      .addMentionableOption((o) => o.setName("m").setDescription("m"))
      .addAttachmentOption((o) => o.setName("a").setDescription("a"));
    expect(sub.toJSON().name).toBe("sub");

    const group = new SubcommandGroupBuilder()
      .setName("grp")
      .setDescription("group desc")
      .addSubcommand((s) => s.setName("sub1").setDescription("sub1"));
    expect(group.toJSON().name).toBe("grp");
  });
});
