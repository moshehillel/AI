-- Platform-wide config (staff password override stored as scrypt hash).
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "staffPasswordHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);
