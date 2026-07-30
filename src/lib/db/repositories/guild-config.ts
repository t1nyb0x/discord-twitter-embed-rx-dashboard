import { eq } from "drizzle-orm";

import { toAnnounceTarget } from "@/lib/announce-target";
import { db } from "@/lib/db";
import {
  channelWhitelist,
  configAuditLogs,
  guildConfigs,
  type ChannelWhitelist,
  type GuildConfig,
} from "@/lib/db/schema";

export function findGuildConfig(guildId: string): Promise<GuildConfig | undefined> {
  return db.query.guildConfigs.findFirst({ where: eq(guildConfigs.guildId, guildId) });
}

export function findChannelWhitelist(guildId: string): Promise<ChannelWhitelist[]> {
  return db.query.channelWhitelist.findMany({ where: eq(channelWhitelist.guildId, guildId) });
}

export async function createDefaultGuildConfig(
  guildId: string,
  userId: string,
): Promise<GuildConfig | undefined> {
  await db
    .insert(guildConfigs)
    .values({
      guildId,
      allowAllChannels: true,
      version: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    })
    .onConflictDoNothing();

  return db.query.guildConfigs.findFirst({ where: eq(guildConfigs.guildId, guildId) });
}

export type SaveGuildConfigParams = {
  guildId: string;
  userId: string;
  allowAllChannels: boolean;
  whitelistedChannelIds: string[];
  maxUrlsPerMessage: number | null;
  announceTargetMode: string | null;
  announceTargetChannelId: string | null;
  currentConfig: Pick<
    GuildConfig,
    | "version"
    | "allowAllChannels"
    | "maxUrlsPerMessage"
    | "announceTargetMode"
    | "announceTargetChannelId"
  >;
  previousChannelIds: string[];
};

export function saveGuildConfig(params: SaveGuildConfigParams): number {
  const {
    guildId,
    userId,
    allowAllChannels,
    whitelistedChannelIds,
    maxUrlsPerMessage,
    announceTargetMode,
    announceTargetChannelId,
    currentConfig,
    previousChannelIds,
  } = params;

  const nextVersion = currentConfig.version + 1;
  const updatedAt = new Date().toISOString();

  db.transaction((tx) => {
    tx.update(guildConfigs)
      .set({
        allowAllChannels,
        version: nextVersion,
        updatedAt,
        updatedBy: userId,
        maxUrlsPerMessage,
        announceTargetMode,
        announceTargetChannelId,
      })
      .where(eq(guildConfigs.guildId, guildId))
      .run();

    tx.delete(channelWhitelist).where(eq(channelWhitelist.guildId, guildId)).run();

    if (whitelistedChannelIds.length > 0) {
      tx.insert(channelWhitelist)
        .values(whitelistedChannelIds.map((channelId) => ({ guildId, channelId })))
        .run();
    }

    tx.insert(configAuditLogs)
      .values({
        guildId,
        userId,
        action: "update",
        oldVersion: currentConfig.version,
        newVersion: nextVersion,
        changes: JSON.stringify({
          previous: {
            allowAllChannels: currentConfig.allowAllChannels,
            whitelistedChannelIds: previousChannelIds,
            maxUrlsPerMessage: currentConfig.maxUrlsPerMessage ?? null,
            announceTarget: toAnnounceTarget({
              announceTargetMode: currentConfig.announceTargetMode ?? null,
              announceTargetChannelId: currentConfig.announceTargetChannelId ?? null,
            }),
          },
          current: {
            allowAllChannels,
            whitelistedChannelIds,
            maxUrlsPerMessage,
            announceTarget: toAnnounceTarget({ announceTargetMode, announceTargetChannelId }),
          },
        }),
      })
      .run();
  });

  return nextVersion;
}
