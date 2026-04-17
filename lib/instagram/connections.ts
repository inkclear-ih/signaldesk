import {
  INSTAGRAM_SOURCE_FAMILY,
  META_INSTAGRAM_PROVIDER,
  computeNextInstagramRefreshAt,
  exchangeForLongLivedToken,
  getMetaInstagramRefreshConfig,
  isInstagramTokenExpired,
  isInstagramTokenNearExpiry
} from "@/lib/instagram/meta";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ENV_FALLBACK_DISABLED_VALUE = "0";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type InstagramConnectionRow = {
  id: string;
  user_id: string;
  source_family: string;
  provider: string;
  status: "connected" | "needs_reconnect" | "disconnected";
  access_token: string | null;
  token_type: string | null;
  token_expires_at: string | null;
  last_refreshed_at: string | null;
  next_refresh_at: string | null;
  refresh_metadata: Record<string, unknown> | null;
  instagram_business_account_id: string | null;
  connected_username: string | null;
  display_name: string | null;
};

export type InstagramCredential = {
  accessToken: string;
  businessAccountId: string;
  source: "user_connection" | "env_fallback";
  userId: string | null;
  connectionId: string | null;
  expiresAt: string | null;
};

export class InstagramCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramCredentialError";
  }
}

export async function resolveInstagramCredentialForSource(
  supabase: SupabaseAdminClient,
  {
    preferredUserId,
    sourceId
  }: {
    preferredUserId?: string;
    sourceId: string;
  }
): Promise<InstagramCredential> {
  if (preferredUserId) {
    const ownsSource = await userOwnsActiveSource(
      supabase,
      sourceId,
      preferredUserId
    );
    if (ownsSource) {
      const preferredConnection = await getConnectedInstagramConnectionForUser(
        supabase,
        preferredUserId
      );
      if (preferredConnection) {
        return getUsableCredentialFromConnection(supabase, preferredConnection);
      }

      const envCredential = getEnvFallbackCredential();
      if (envCredential) {
        return envCredential;
      }

      throw new InstagramCredentialError(
        "Connect Instagram before scanning Instagram professional account sources."
      );
    }
  }

  const ownerConnection = await getFirstConnectionForSourceOwner(
    supabase,
    sourceId
  );
  if (ownerConnection) {
    return getUsableCredentialFromConnection(supabase, ownerConnection);
  }

  const envCredential = getEnvFallbackCredential();
  if (envCredential) {
    return envCredential;
  }

  throw new InstagramCredentialError(
    "Connect Instagram before scanning Instagram professional account sources."
  );
}

async function userOwnsActiveSource(
  supabase: SupabaseAdminClient,
  sourceId: string,
  userId: string
): Promise<boolean> {
  const { data: owner, error: ownerError } = await supabase
    .from("user_sources")
    .select("user_id")
    .eq("source_id", sourceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (ownerError) {
    throw new InstagramCredentialError(
      `Could not check Instagram source ownership: ${ownerError.message}`
    );
  }

  return Boolean(owner);
}

async function getFirstConnectionForSourceOwner(
  supabase: SupabaseAdminClient,
  sourceId: string
): Promise<InstagramConnectionRow | null> {
  const { data: owners, error: ownersError } = await supabase
    .from("user_sources")
    .select("user_id,created_at")
    .eq("source_id", sourceId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (ownersError) {
    throw new InstagramCredentialError(
      `Could not load Instagram source owners: ${ownersError.message}`
    );
  }

  const ownerIds = [
    ...new Set(
      (owners ?? [])
        .map((owner) => String(owner.user_id ?? ""))
        .filter(Boolean)
    )
  ];
  if (!ownerIds.length) {
    return null;
  }

  const { data: connections, error: connectionsError } = await supabase
    .from("user_provider_connections")
    .select(
      "id,user_id,source_family,provider,status,access_token,token_type,token_expires_at,last_refreshed_at,next_refresh_at,refresh_metadata,instagram_business_account_id,connected_username,display_name"
    )
    .eq("provider", META_INSTAGRAM_PROVIDER)
    .eq("source_family", INSTAGRAM_SOURCE_FAMILY)
    .eq("status", "connected")
    .in("user_id", ownerIds);

  if (connectionsError) {
    throw new InstagramCredentialError(
      `Could not load Instagram connections: ${connectionsError.message}`
    );
  }

  const connectionsByUserId = new Map(
    ((connections ?? []) as InstagramConnectionRow[]).map((connection) => [
      connection.user_id,
      connection
    ])
  );

  for (const ownerId of ownerIds) {
    const connection = connectionsByUserId.get(ownerId);
    if (connection) {
      return connection;
    }
  }

  return null;
}

async function getConnectedInstagramConnectionForUser(
  supabase: SupabaseAdminClient,
  userId: string
): Promise<InstagramConnectionRow | null> {
  const { data, error } = await supabase
    .from("user_provider_connections")
    .select(
      "id,user_id,source_family,provider,status,access_token,token_type,token_expires_at,last_refreshed_at,next_refresh_at,refresh_metadata,instagram_business_account_id,connected_username,display_name"
    )
    .eq("user_id", userId)
    .eq("provider", META_INSTAGRAM_PROVIDER)
    .eq("source_family", INSTAGRAM_SOURCE_FAMILY)
    .eq("status", "connected")
    .maybeSingle();

  if (error) {
    throw new InstagramCredentialError(
      `Could not load Instagram connection: ${error.message}`
    );
  }

  return (data as InstagramConnectionRow | null) ?? null;
}

async function getUsableCredentialFromConnection(
  supabase: SupabaseAdminClient,
  connection: InstagramConnectionRow
): Promise<InstagramCredential> {
  if (!connection.access_token || !connection.instagram_business_account_id) {
    await markConnectionNeedsReconnect(
      supabase,
      connection.id,
      "Instagram connection is missing token details."
    );
    throw new InstagramCredentialError(
      "Reconnect Instagram before scanning Instagram sources."
    );
  }

  if (isInstagramTokenExpired(connection.token_expires_at)) {
    await markConnectionNeedsReconnect(
      supabase,
      connection.id,
      "Instagram long-lived token has expired."
    );
    throw new InstagramCredentialError(
      "Reconnect Instagram before scanning Instagram sources."
    );
  }

  if (isInstagramTokenNearExpiry(connection.token_expires_at)) {
    return refreshConnectionCredential(supabase, connection);
  }

  return {
    accessToken: connection.access_token,
    businessAccountId: connection.instagram_business_account_id,
    source: "user_connection",
    userId: connection.user_id,
    connectionId: connection.id,
    expiresAt: connection.token_expires_at
  };
}

async function refreshConnectionCredential(
  supabase: SupabaseAdminClient,
  connection: InstagramConnectionRow
): Promise<InstagramCredential> {
  if (!connection.access_token || !connection.instagram_business_account_id) {
    throw new InstagramCredentialError(
      "Reconnect Instagram before scanning Instagram sources."
    );
  }

  const attemptedAt = new Date().toISOString();

  try {
    const refreshed = await exchangeForLongLivedToken({
      accessToken: connection.access_token,
      config: getMetaInstagramRefreshConfig()
    });
    const nextRefreshAt = computeNextInstagramRefreshAt(refreshed.expiresAt);
    const refreshMetadata = {
      ...(connection.refresh_metadata ?? {}),
      supports_refresh: true,
      refresh_method: "fb_exchange_token",
      last_refresh_at: attemptedAt,
      last_refresh_expires_in: refreshed.expiresIn
    };

    const { error } = await supabase
      .from("user_provider_connections")
      .update({
        access_token: refreshed.accessToken,
        token_type: refreshed.tokenType ?? connection.token_type,
        token_expires_at: refreshed.expiresAt,
        last_refreshed_at: attemptedAt,
        next_refresh_at: nextRefreshAt,
        refresh_attempted_at: attemptedAt,
        refresh_error: null,
        refresh_metadata: refreshMetadata,
        status: "connected"
      })
      .eq("id", connection.id);

    if (error) {
      throw new InstagramCredentialError(
        `Could not persist refreshed Instagram token: ${error.message}`
      );
    }

    return {
      accessToken: refreshed.accessToken,
      businessAccountId: connection.instagram_business_account_id,
      source: "user_connection",
      userId: connection.user_id,
      connectionId: connection.id,
      expiresAt: refreshed.expiresAt
    };
  } catch (error) {
    await markConnectionNeedsReconnect(
      supabase,
      connection.id,
      getRefreshFailureMessage(error),
      attemptedAt
    );
    throw new InstagramCredentialError(
      "Reconnect Instagram before scanning Instagram sources."
    );
  }
}

async function markConnectionNeedsReconnect(
  supabase: SupabaseAdminClient,
  connectionId: string,
  reason: string,
  attemptedAt = new Date().toISOString()
) {
  await supabase
    .from("user_provider_connections")
    .update({
      status: "needs_reconnect",
      refresh_attempted_at: attemptedAt,
      refresh_error: reason
    })
    .eq("id", connectionId);
}

function getEnvFallbackCredential(): InstagramCredential | null {
  if (
    process.env.INSTAGRAM_ALLOW_ENV_CREDENTIAL_FALLBACK ===
    ENV_FALLBACK_DISABLED_VALUE
  ) {
    return null;
  }

  const accessToken = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN;
  const businessAccountId = process.env.INSTAGRAM_GRAPH_BUSINESS_ACCOUNT_ID;
  if (!accessToken || !businessAccountId) {
    return null;
  }

  return {
    accessToken,
    businessAccountId,
    source: "env_fallback",
    userId: null,
    connectionId: null,
    expiresAt: null
  };
}

function getRefreshFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Instagram token refresh failed.";
}
