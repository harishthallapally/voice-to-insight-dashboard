import {
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import { CosmosClient, type Container } from "@azure/cosmos";

const DEFAULT_ORGANIZATION_ID = "tvs";
const PASSWORD_HASH_ITERATIONS = 120_000;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_DIGEST = "sha512";

export type SignupProfile = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber: string;
  status: "Active";
  createdAt: string;
  updatedAt: string;
};

type SignupProfileRecord = SignupProfile & {
  passwordHash: string;
  passwordSalt: string;
  passwordHashVersion: 1;
};

type StoredSignupProfile = SignupProfile &
  Partial<{
    fullName: string;
    department: string;
    role: string;
  }> &
  Partial<
    Pick<
      SignupProfileRecord,
      "passwordHash" | "passwordSalt" | "passwordHashVersion"
    >
  >;

export type CreateSignupProfileInput = {
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

type CosmosConfig = {
  endpoint: string;
  key: string;
  databaseId: string;
  containerId: string;
  organizationId: string;
};

let cachedContainer: Container | null = null;
let cachedConfigSignature = "";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getCosmosConfig(): CosmosConfig {
  return {
    endpoint: getRequiredEnv("AZURE_COSMOS_ENDPOINT"),
    key: getRequiredEnv("AZURE_COSMOS_KEY"),
    databaseId: getRequiredEnv("AZURE_COSMOS_DATABASE_ID"),
    containerId: getRequiredEnv("AZURE_COSMOS_CONTAINER_ID"),
    organizationId:
      process.env.AZURE_COSMOS_ORGANIZATION_ID?.trim() ||
      DEFAULT_ORGANIZATION_ID
  };
}

function getCosmosContainer(config: CosmosConfig) {
  const configSignature = [
    config.endpoint,
    config.databaseId,
    config.containerId
  ].join("|");

  if (cachedContainer && cachedConfigSignature === configSignature) {
    return cachedContainer;
  }

  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key
  });

  cachedContainer = client
    .database(config.databaseId)
    .container(config.containerId);
  cachedConfigSignature = configSignature;

  return cachedContainer;
}

function createSignupId(email: string) {
  return `user-${Buffer.from(email.toLowerCase()).toString("base64url")}`;
}

function createPasswordHash(
  password: string,
  salt = randomBytes(16).toString("base64url")
) {
  return {
    passwordSalt: salt,
    passwordHash: pbkdf2Sync(
      password,
      salt,
      PASSWORD_HASH_ITERATIONS,
      PASSWORD_HASH_KEY_LENGTH,
      PASSWORD_HASH_DIGEST
    ).toString("base64url"),
    passwordHashVersion: 1 as const
  };
}

function isPasswordMatch(
  password: string,
  storedHash: string,
  storedSalt: string
) {
  const calculatedHash = createPasswordHash(password, storedSalt).passwordHash;
  const calculatedHashBuffer = Buffer.from(calculatedHash);
  const storedHashBuffer = Buffer.from(storedHash);

  return (
    calculatedHashBuffer.length === storedHashBuffer.length &&
    timingSafeEqual(calculatedHashBuffer, storedHashBuffer)
  );
}

function toPublicSignupProfile(record: StoredSignupProfile): SignupProfile {
  const legacyNameParts = (record.fullName || "").trim().split(/\s+/);

  return {
    id: record.id,
    organizationId: record.organizationId,
    firstName: record.firstName || legacyNameParts[0] || "",
    lastName: record.lastName || legacyNameParts.slice(1).join(" ") || "",
    email: record.email,
    mobileNumber: record.mobileNumber,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function hasPasswordAuth(
  record: StoredSignupProfile
): record is SignupProfileRecord {
  return Boolean(record.passwordHash && record.passwordSalt);
}

function hasStatusCode(error: unknown, statusCode: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === statusCode
  );
}

export async function createSignupProfile(input: CreateSignupProfileInput) {
  const config = getCosmosConfig();
  const container = getCosmosContainer(config);
  const now = new Date().toISOString();
  const normalizedEmail = input.email.trim().toLowerCase();
  const passwordAuth = createPasswordHash(input.password);
  const signupProfile: SignupProfileRecord = {
    id: createSignupId(normalizedEmail),
    organizationId: config.organizationId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: normalizedEmail,
    mobileNumber: input.mobileNumber.trim(),
    status: "Active",
    createdAt: now,
    updatedAt: now,
    ...passwordAuth
  };

  try {
    const existingProfile = await container
      .item(signupProfile.id, signupProfile.organizationId)
      .read<StoredSignupProfile>();

    if (existingProfile.resource) {
      if (!hasPasswordAuth(existingProfile.resource)) {
        const upgradedProfile: SignupProfileRecord = {
          ...signupProfile,
          createdAt: existingProfile.resource.createdAt || signupProfile.createdAt,
          updatedAt: now,
          ...passwordAuth
        };

        const updatedProfile = await container
          .item(signupProfile.id, signupProfile.organizationId)
          .replace(upgradedProfile);

        return {
          profile: toPublicSignupProfile(
            updatedProfile.resource || upgradedProfile
          ),
          created: true
        };
      }

      return {
        profile: toPublicSignupProfile(existingProfile.resource),
        created: false
      };
    }
  } catch (error) {
    if (!hasStatusCode(error, 404)) {
      throw error;
    }
  }

  const createdProfile = await container.items.create(signupProfile);

  return {
    profile: toPublicSignupProfile(createdProfile.resource || signupProfile),
    created: true
  };
}

export async function verifyLogin(input: LoginInput) {
  const config = getCosmosConfig();
  const container = getCosmosContainer(config);
  const normalizedEmail = input.email.trim().toLowerCase();
  const profileId = createSignupId(normalizedEmail);

  try {
    const existingProfile = await container
      .item(profileId, config.organizationId)
      .read<StoredSignupProfile>();

    if (!existingProfile.resource) {
      return { profile: null };
    }

    if (
      !hasPasswordAuth(existingProfile.resource) ||
      !isPasswordMatch(
        input.password,
        existingProfile.resource.passwordHash,
        existingProfile.resource.passwordSalt
      )
    ) {
      return { profile: null };
    }

    return { profile: toPublicSignupProfile(existingProfile.resource) };
  } catch (error) {
    if (hasStatusCode(error, 404)) {
      return { profile: null };
    }

    throw error;
  }
}
